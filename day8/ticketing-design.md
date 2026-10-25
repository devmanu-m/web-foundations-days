# TicketHub Design

TicketHub sells tickets for concerts and events. Sections: requirements, estimates, API, data model, preventing double-booking, architecture, trade-offs.

## 1. Requirements

**Functional:** register and log in; browse and search events; view a seat map; hold seats for 5 minutes; pay and receive tickets; view my tickets.

**Non-functional:**

- **Correctness:** a seat is never sold to two people.
- **Speed:** browsing under 300 ms and a seat hold under 1 second, even in a big sale.
- **Fairness:** first come, first served through a waiting room; at most 4 tickets per user; rate limits against bots.
- **Availability and durability:** 99.9% uptime, no single point of failure, and a paid order is never lost.
- **Security:** HTTPS, hashed passwords, and card details handled only by a payment provider.

## 2. Estimates

**Normal day:** 50,000 visitors x 10 pages = 500,000 views per day. 500,000 / 86,400 = about 6 per second, and about 30 at peak (5x). Tickets: 5,000 / 86,400 = about 0.06 per second.

**Big sale:** 200,000 people in 600 seconds = about 333 arrivals per second. At 10 requests each, that is about 3,300 requests per second. Selling 20,000 seats in 600 seconds = about 33 sales per second. That is 10 buyers for every seat.

**Comparison:** about 550 times more traffic than a normal day, arriving in a 10-minute spike. Autoscaling is too slow to react, so the design uses a waiting room, a cache, and servers started before the sale.

## 3. API

Base path `/api/v1`, with a bearer token on every endpoint except the first two.

| Method | Path | Description | Success |
|---|---|---|---|
| GET | `/events` | List and search events | 200 |
| GET | `/events/{id}` | One event | 200 |
| GET | `/events/{id}/seats` | Seat map with status | 200 |
| POST | `/events/{id}/holds` | Hold seats for 5 minutes | 201 |
| DELETE | `/holds/{id}` | Release a hold | 204 |
| POST | `/orders` | Pay for held seats (needs an `Idempotency-Key` header) | 201 |
| GET | `/me/tickets` | My tickets | 200 |

Hold request: `{ "seatIds": [301, 302] }`. Hold response: `{ "holdId": 88, "expiresAt": "2026-11-01T18:05:00Z" }`.

Errors: **400** no seats or more than 4; **401** missing token; **404** unknown event or hold; **409** seat already held or sold, or hold expired; **429** too many requests; **503** overloaded, user sent to the waiting room.

## 4. Data model

| Table | Columns |
|---|---|
| users | id PK, name, email UNIQUE, password_hash |
| events | id PK, name, venue, starts_at, on_sale_at |
| seats | id PK, event_id FK, section, row_label, seat_number, price_cents, status (available / held / sold), held_by FK users, hold_expires_at; UNIQUE (event_id, section, row_label, seat_number) |
| orders | id PK, user_id FK, total_cents, status (pending / paid / failed), idempotency_key UNIQUE |
| tickets | id PK, order_id FK, seat_id FK UNIQUE, code UNIQUE |

**Relationships:** event to seats is one-to-many; user to orders is one-to-many; order to tickets is one-to-many; seat to ticket is one-to-one (the UNIQUE on `seat_id`); users to events is many-to-many through orders, tickets and seats.

**Index:** `seats (event_id, status)` makes "free seats for this event" fast in a big sale.

## 5. Preventing two people buying the same seat

Three layers protect every seat.

**Layer 1: an atomic hold.** One conditional UPDATE checks and changes the seat in a single step:

    UPDATE seats
    SET status = 'held', held_by = :user, hold_expires_at = :expiry
    WHERE id = :seat
      AND (status = 'available'
           OR (status = 'held' AND hold_expires_at < :now));

If 1 row changes, the user has the seat. If 0 rows change, someone else got there first, and the API returns 409. When two requests collide, the database locks the row and runs them one after the other, so the second one loses.

**Layer 2: a transaction when paying.** Check that every seat is still held by this user and not expired. Create a pending order with the idempotency key and charge the card. If the payment succeeds, one transaction sets the seats to `sold`, marks the order `paid` and inserts the tickets, and either all of it commits or none does. If it fails, the order becomes `failed` and the seats are released.

**Layer 3: constraints as the last defence.** `UNIQUE (seat_id)` on tickets makes it impossible to store two tickets for one seat, even if the code has a bug. `UNIQUE (idempotency_key)` stops a double-click from charging twice.

Holds expire after 5 minutes, and a worker also resets expired holds every minute. All holds and payments go to the **primary** database only, because a replica may show old data.

## 6. Architecture

    Client
      |
    DNS ------> CDN (event pages, images, JS, CSS)
      |
    Waiting room + rate limiter
      |
    Load balancer (active + passive pair)
      |
    App servers (many, stateless)
      |            |              |
    Cache       Primary DB      Queue --> Workers
    (Redis)      |      \                (emails, PDFs,
                 |       Payment          expired holds)
            Read replica  provider

**Components, one sentence each:**

- **Client:** the browser or app where people browse and buy.
- **DNS:** turns the site name into an address and can fail over to a backup site.
- **CDN:** serves static pages and images near the user, so most traffic never reaches our servers.
- **Waiting room and rate limiter:** lets people in at a speed the system can handle, in arrival order, and blocks bots.
- **Load balancer:** spreads requests over the app servers, and its passive twin takes over the same virtual IP if it fails.
- **App servers:** run the API logic, and being stateless, many more can be started before a sale.
- **Cache:** holds event details and a seat map refreshed every second or two, so thousands of viewers do not query the database.
- **Primary database:** the single source of truth for seats and orders, which keeps the booking rules in one place.
- **Read replica:** answers browsing queries to take load off the primary.
- **Payment provider:** handles card payments, so we never store card numbers.
- **Queue and workers:** do slow jobs (emails, ticket PDFs, expired holds) so a purchase never waits for them.

**How it survives the big sale:** the CDN absorbs static requests; the waiting room turns 333 arrivals per second into a steady flow; the cache serves the seat map, so about 3,300 requests per second do not all hit the database; servers are started before the sale; the primary only handles about 1,000 small indexed hold attempts per second; and the queue keeps slow jobs out of the buying path.

## 7. Trade-offs

- **Waiting room: fairness and stability vs convenience.** People wait their turn, which protects the system, but some will give up, and it adds a component to run.
- **Cached seat map: speed vs accuracy.** A seat map one or two seconds old lets thousands browse cheaply, but a user may click a seat that was just taken and get a 409. The atomic hold always decides, and the app says "That seat was just taken, please choose another."
- **One primary database: safety vs write scale.** Sending all holds and payments to one primary is the safest way to avoid double-booking, but it caps write speed. That is enough for 20,000 seats, and a larger system could split events across several databases.

**Single points of failure:** load balancer as an active-passive pair; many app servers; the replica can be promoted if the primary fails, with daily backups; a cache cluster that falls back to the database; a replicated queue; and DNS and CDN providers with servers worldwide.