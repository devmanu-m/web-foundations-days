# TicketHub Design

TicketHub is a website that sells tickets for concerts and events. This document follows the six-part framework: requirements, estimates, API, data model, architecture and trade-offs. It also explains how the design stops two people buying the same seat.

## 1. Requirements

### Functional

- Users can register and log in.
- Users can browse events and search them by name, date or venue.
- Users can view the seat map of an event with each seat's price and availability.
- Users can hold seats for a short time (5 minutes) while they pay.
- Users can pay for held seats and receive tickets.
- Users can view their tickets and their order history.

### Non-functional

- **Correctness:** a seat is never sold to two people. This is the most important rule.
- **Speed:** browsing pages load in under 300 ms, and a seat hold answers in under 1 second, even during a big sale.
- **Fairness:** during a big sale, people are served in the order they arrived, and one person cannot take all the seats (a limit of 4 tickets per user and rate limiting against bots).
- **Availability:** 99.9% uptime, and no single point of failure.
- **Durability:** a paid order is never lost.
- **Security:** HTTPS everywhere, hashed passwords, and card details handled only by a payment provider.

## 2. Estimates

Assumptions: 2 million registered users, 86,400 seconds in a day, peak traffic on a normal day is 5 times the average.

### Normal day

| Measure | Working | Result |
|---|---|---|
| Page views per day | 50,000 visitors x 10 pages | 500,000 |
| Page views per second (average) | 500,000 / 86,400 | about 6 |
| Page views per second (peak) | 6 x 5 | about 30 |
| Tickets sold per second (average) | 5,000 / 86,400 | about 0.06 (one every 17 seconds) |
| Tickets sold per second (peak) | 0.06 x 5 | about 0.3 |

### Big sale (a popular concert)

Assumptions: 200,000 people arrive within 10 minutes (600 seconds), and each makes about 10 requests (event page, seat map, seat holds and retries).

| Measure | Working | Result |
|---|---|---|
| Users arriving per second | 200,000 / 600 | about 333 |
| Requests per second | 200,000 x 10 / 600 | about 3,300 |
| Seat hold attempts per second | 200,000 x 3 attempts / 600 | about 1,000 |
| Tickets sold per second if sold out in 10 minutes | 20,000 / 600 | about 33 |
| Competition per seat | 200,000 / 20,000 | 10 people for every seat |

### Comparison

- Requests: about 3,300 per second against about 6 on a normal day, roughly **550 times more**.
- Purchases: about 33 per second against about 0.06, also roughly **550 times more**.
- The load arrives in a spike of about 10 minutes, so it is too sudden for normal scaling to react. The design needs a waiting room, caching and servers prepared in advance.
- Storage is small: 5,000 tickets a day is about 1.8 million tickets a year, which is only a few GB.

## 3. API

Base path: `/api/v1`. All endpoints except the first two need an `Authorization: Bearer <token>` header.

| Method | Path | Description | Success status |
|---|---|---|---|
| GET | `/events` | List and search events (`?q=`, `?date=`, `?page=`) | 200 OK |
| GET | `/events/{id}` | Get one event | 200 OK |
| GET | `/events/{id}/seats` | Seat map with the status of each seat | 200 OK |
| POST | `/events/{id}/holds` | Hold one or more seats for 5 minutes | 201 Created |
| DELETE | `/holds/{id}` | Release a hold | 204 No Content |
| POST | `/orders` | Pay for the held seats | 201 Created |
| GET | `/me/tickets` | List the logged-in user's tickets | 200 OK |

Hold request, `POST /api/v1/events/12/holds`:

    { "seatIds": [301, 302] }

Hold response, `201 Created`:

    { "holdId": 88, "seatIds": [301, 302], "expiresAt": "2026-11-01T18:05:00Z" }

Order request, `POST /api/v1/orders` (with a header `Idempotency-Key: 7f3c...`):

    { "holdId": 88, "paymentToken": "tok_abc123" }

Errors:

| Status | When it happens |
|---|---|
| 400 Bad Request | A hold with no seats, or more than 4 seats |
| 401 Unauthorized | Missing or expired token |
| 404 Not Found | Event or hold does not exist |
| 409 Conflict | A seat is already held or sold, or the hold has expired |
| 429 Too Many Requests | A user or IP sends too many requests (bot protection) |
| 503 Service Unavailable | The system is overloaded and the user is sent to the waiting room |

Example 409 body:

    { "error": { "code": 409, "message": "Seat 302 is no longer available", "seatId": 302 } }

## 4. Data model

Five tables: users, events, seats, orders and tickets.

    CREATE TABLE users (
      id            INTEGER PRIMARY KEY,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL
    );

    CREATE TABLE events (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      venue      TEXT NOT NULL,
      starts_at  TEXT NOT NULL,
      on_sale_at TEXT NOT NULL
    );

    CREATE TABLE seats (
      id              INTEGER PRIMARY KEY,
      event_id        INTEGER NOT NULL REFERENCES events(id),
      section         TEXT NOT NULL,
      row_label       TEXT NOT NULL,
      seat_number     INTEGER NOT NULL,
      price_cents     INTEGER NOT NULL,
      status          TEXT NOT NULL DEFAULT 'available'
                      CHECK (status IN ('available', 'held', 'sold')),
      held_by         INTEGER REFERENCES users(id),
      hold_expires_at TEXT,
      UNIQUE (event_id, section, row_label, seat_number)
    );

    CREATE TABLE orders (
      id              INTEGER PRIMARY KEY,
      user_id         INTEGER NOT NULL REFERENCES users(id),
      total_cents     INTEGER NOT NULL,
      status          TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed')),
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE tickets (
      id       INTEGER PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      seat_id  INTEGER NOT NULL UNIQUE REFERENCES seats(id),
      code     TEXT NOT NULL UNIQUE
    );

Relationships:

- **events to seats is one-to-many:** one event has many seats, and each seat belongs to one event.
- **users to orders is one-to-many:** one user can make many orders.
- **orders to tickets is one-to-many:** one order contains many tickets (up to 4).
- **seats to tickets is one-to-one:** the UNIQUE constraint on `tickets.seat_id` means a seat can appear on at most one ticket, ever.
- **users to events is many-to-many through orders, tickets and seats:** a user attends many events, and an event has many attendees.

Index: `CREATE INDEX idx_seats_event_status ON seats (event_id, status);` makes "show the free seats for this event" fast, which is the most common query in a big sale.

## 5. Preventing two people buying the same seat

Three layers protect each seat, so that if one fails the next still holds.

**Layer 1: an atomic hold.** Holding a seat is one conditional UPDATE. The database checks and changes the row in a single step, so two people cannot both succeed:

    UPDATE seats
    SET status = 'held', held_by = :user_id, hold_expires_at = :expiry
    WHERE id = :seat_id
      AND (status = 'available'
           OR (status = 'held' AND hold_expires_at < :now));

If the database reports 1 row changed, the user has the seat. If it reports 0, someone else got there first and the API returns 409 Conflict. When two requests arrive at the same moment, the database locks the row, runs them one after the other, and the second sees the seat already held.

**Layer 2: a transaction when paying.** The payment steps run inside one transaction, so either everything happens or nothing does:

1. Check that every seat is still held by this user and the hold has not expired. Reject with 409 if not.
2. Create an order with status `pending` and the user's `Idempotency-Key`, then charge the card through the payment provider.
3. If the payment succeeds, start a transaction that sets the seats to `sold`, marks the order `paid` and inserts the tickets. Commit.
4. If the payment fails, set the order to `failed` and release the seats.

**Layer 3: constraints as the last line of defence.** The `UNIQUE` constraint on `tickets.seat_id` makes it impossible for the database to store two tickets for one seat, even if there is a bug in the code. The UNIQUE `idempotency_key` stops a double-click or a retry from creating two orders and charging the card twice.

**Holds expire.** A hold lasts 5 minutes. After that the seat can be held again (see the condition in Layer 1), so seats do not stay locked by people who left. A background worker also resets expired holds every minute so that the seat map stays accurate.

All writes go to the **primary database only**. Read replicas are never used for holds or payments, because a replica may show old data.

## 6. Architecture

    Client (browser / mobile app)
          |
          v
    +-----------+        +-----------+
    |    DNS    |        |    CDN    |  event pages, images, JS, CSS
    +-----------+        +-----------+
          |
          v
    +----------------------------+
    | Waiting room + rate limiter|  lets users in at a controlled speed
    +----------------------------+
          |
          v
    +--------------------------+
    |  Load balancer (pair)    |  active + passive, shared virtual IP
    +--------------------------+
          |          |          |
          v          v          v
    +---------+ +---------+ +---------+
    |  App    | |  App    | |  App    |  many servers, stateless,
    | server  | | server  | | server  |  more added before a sale
    +---------+ +---------+ +---------+
          |                       |
          |        +--------------+------------------+
          v        v                                 v
    +---------+  +--------------+              +-----------+
    |  Cache  |  |   Primary    |              |   Queue   |
    | (Redis) |  |   database   |              +-----------+
    +---------+  +--------------+                    |
                    |       |                        v
         replication|       |                   +-----------+
                    v       v                   |  Workers  |
          +--------------+  +-----------+       +-----------+
          | Read replica |  | Payment   |<------- emails, ticket PDFs,
          | (browsing)   |  | provider  |         expired-hold cleanup
          +--------------+  +-----------+

### What each component does

- **Client:** the browser or app where users browse events and buy tickets.
- **DNS:** turns the name tickethub.example into the address of the system, and can switch to a backup location if one fails.
- **CDN:** serves event pages, images and scripts from servers near the user, so most of the traffic never reaches our servers.
- **Waiting room and rate limiter:** during a big sale, lets users in at a speed the system can handle, in the order they arrived, and blocks bots that send too many requests, which keeps the sale fair and the servers alive.
- **Load balancer (active-passive pair):** spreads requests across the app servers, and a passive twin with a shared virtual IP takes over if the active one fails, so it is not a single point of failure.
- **App servers:** run the API logic (browsing, holds, orders), and because they are stateless, we can add many more before a sale.
- **Cache (Redis):** stores event details and a seat map that is refreshed every second or two, so thousands of people looking at the seat map do not each query the database.
- **Primary database:** the single source of truth for seats and orders, where all writes happen, so the hold and purchase rules are enforced in one place.
- **Read replica:** answers browsing queries such as event lists and search, which takes load off the primary.
- **Payment provider:** a third-party service that handles card payments, so we never store card numbers.
- **Queue:** holds slow jobs so the API can reply quickly instead of waiting for them.
- **Workers:** take jobs from the queue, such as sending confirmation emails, creating ticket PDFs and releasing expired holds.

### How it survives the big sale

1. **The CDN** absorbs the thousands of requests for the event page and static files.
2. **The waiting room** turns a spike of 333 arrivals per second into a steady flow the servers can manage, in arrival order.
3. **The cache** serves the seat map, so about 3,300 requests per second do not all reach the database.
4. **More app servers** are started before the sale begins, because scaling after the spike would be too late.
5. **The primary database** only receives the hold and payment writes, about 1,000 hold attempts per second at most. Each is a single small UPDATE on an indexed row, which a well-sized primary can handle.
6. **The queue** moves emails and PDFs out of the buying path, so a slow email service cannot slow down a purchase.
7. **Rate limits and the 4-ticket limit** stop bots from taking the seats.

## 7. Trade-offs

- **Waiting room: fairness and stability vs convenience.** Users wait their turn instead of being served at once, which protects the system and keeps the sale orderly. The cost is that some users wait and may give up, and it adds a component to run.
- **Cached seat map: speed vs accuracy.** A seat map that is one or two seconds old lets thousands of people browse cheaply, but a user may click a seat that was just taken and get a 409. We accept this, because the atomic hold in the database always decides the truth, and the app simply shows "Sorry, that seat was just taken. Please choose another."
- **Hold duration: fairness vs seat usage.** A 5-minute hold gives people time to pay, but while it lasts, other people cannot buy that seat. A longer hold is kinder to buyers and worse for people waiting. Shorter holds free seats sooner but may rush users.
- **Strong consistency on the primary vs scale:** all holds and payments go through one primary database, which is the safest way to avoid double-booking, but it caps how fast writes can go. For one event of 20,000 seats this is enough. A much larger system could split seats between several databases by event.

## 8. Avoiding single points of failure

- **Load balancer:** an active-passive pair sharing a virtual IP, so if the active one fails, the passive one takes over the same address.
- **App servers:** many instances, so losing one does not matter.
- **Database:** the read replica can be promoted if the primary fails, with daily backups and continuous copying of changes.
- **Cache:** a small cluster, and if it fails, requests fall back to the database, slower but working.
- **Queue:** a replicated queue service, so jobs are not lost if one node fails.
- **DNS and CDN:** providers with servers around the world.