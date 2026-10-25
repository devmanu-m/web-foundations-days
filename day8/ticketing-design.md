# TicketHub Design

## 1. Requirements

**Functional:** register and log in, browse events, view a seat map, hold seats (5 minutes), pay, view my tickets.

**Non-functional:** correctness (never sell a seat twice), speed (browse under 300 ms, hold under 1 s), fairness (first come first served, max 4 tickets each, anti-bot limits), 99.9% availability with no single point of failure, and paid orders never lost.

## 2. Estimates

- **Normal day:** 50,000 users x 10 pages = 500,000 views per day = about 6 per second (30 at a 5x peak). 5,000 tickets per day = 0.06 per second.
- **Big sale:** 200,000 users in 600 s = 333 arrivals per second, about 3,300 requests per second. 20,000 seats in 600 s = 33 sales per second. That is 10 buyers for every seat.
- **Comparison:** about 550 times the normal traffic in a 10-minute spike. Autoscaling is too slow, so we need a waiting room, a cache and servers started before the sale.

## 3. API (`/api/v1`, bearer token)

- `GET /events`: list and search events (200)
- `GET /events/{id}/seats`: seat map (200)
- `POST /events/{id}/holds`: hold seats, body `{"seatIds":[301,302]}` (201)
- `DELETE /holds/{id}`: release a hold (204)
- `POST /orders`: pay, with an `Idempotency-Key` header (201)
- `GET /me/tickets`: my tickets (200)

Errors: 400 bad request, 401 not logged in, 404 not found, 409 seat taken or hold expired, 429 too many requests, 503 overloaded (waiting room).

## 4. Data model

- **users** (id PK, name, email UNIQUE)
- **events** (id PK, name, venue, starts_at)
- **seats** (id PK, event_id FK, section, row, number, price, status, held_by FK, hold_expires_at; UNIQUE per event, section, row, number)
- **orders** (id PK, user_id FK, total, status, idempotency_key UNIQUE)
- **tickets** (id PK, order_id FK, seat_id FK UNIQUE)

Relationships: event to seats, user to orders and order to tickets are one-to-many. Seat to ticket is one-to-one. Index: `seats (event_id, status)` for fast "free seats" lookups.

## 5. Preventing double-booking

**Layer 1, atomic hold.** One UPDATE checks and changes the seat in a single step:

    UPDATE seats SET status='held', held_by=:user, hold_expires_at=:expiry
    WHERE id=:seat AND (status='available' OR hold_expires_at < :now);

If 1 row changes, the seat is yours. If 0 rows change, someone was first and the API returns 409. The database locks the row, so two requests run one after the other.

**Layer 2, transaction on payment.** In one transaction: confirm the hold is still yours, mark the seats sold, mark the order paid and insert the tickets. All of it commits or none of it does.

**Layer 3, constraints.** UNIQUE `tickets.seat_id` makes a second ticket for a seat impossible, and UNIQUE `idempotency_key` stops double charges on retries.

Holds expire after 5 minutes. Holds and payments use only the primary database, never a replica, which may show old data.

## 6. Trade-offs

- **Cached seat map: speed vs accuracy.** A map 1 to 2 seconds old lets thousands browse without hitting the database, but a user may click a seat that was just taken and get a 409. The atomic hold always decides.
- **Waiting room: fairness vs convenience.** People wait their turn, which protects the system, but some will give up.
- **One primary database: consistency vs write scale.** It is the safest way to avoid double-booking, but it limits write speed. That is enough for 20,000 seats.

## 7. Architecture

    Client -> DNS -> CDN (static files)
       |
    Waiting room + rate limiter
       |
    Load balancer (active + passive pair)
       |
    App servers (many, stateless)
       |-- Cache
       |-- Primary DB --> Read replica
       |-- Payment provider
       |-- Queue --> Workers

- **DNS:** finds the site's address and can fail over to a backup.
- **CDN:** serves static files near users, so most traffic never reaches our servers.
- **Waiting room:** admits people at a safe speed in arrival order and blocks bots.
- **Load balancer:** spreads requests, and its passive twin takes over the same IP if it fails.
- **App servers:** run the API, and being stateless, many can be started before a sale.
- **Cache:** serves the seat map so thousands of viewers skip the database.
- **Primary database:** the single source of truth for seats and orders.
- **Read replica:** answers browsing queries to relieve the primary.
- **Payment provider:** takes card payments so we never store card numbers.
- **Queue and workers:** send emails, make ticket PDFs and clear expired holds outside the buying path.

**Surviving the sale:** the CDN and cache absorb about 3,300 requests per second, the waiting room smooths 333 arrivals per second, and the primary sees only about 1,000 small indexed hold attempts per second.

**No single point of failure:** a load balancer pair, many app servers, a replica that can be promoted, a cache that falls back to the database, a replicated queue, and worldwide DNS and CDN.