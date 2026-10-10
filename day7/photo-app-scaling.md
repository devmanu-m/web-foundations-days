# SnapShare Scaling Plan

SnapShare is a photo-sharing app. Users upload photos and scroll a feed of photos from people they follow.

## Assumptions

- 10 million registered users.
- 10% are active each day, so **1,000,000 daily active users (DAU)**.
- Each active user uploads 1 photo per day.
- Each active user views 50 feed pages per day.
- An average photo is 2 MB. Each photo also gets a 50 KB thumbnail.
- One day has 86,400 seconds.
- Peak traffic is 5 times the average.

## Estimates

### Uploads per second

- Uploads per day: 1,000,000 users x 1 photo = 1,000,000
- Average: 1,000,000 / 86,400 = about **12 uploads per second**
- Peak: 12 x 5 = about **58 uploads per second**

### Feed views per second

- Feed views per day: 1,000,000 users x 50 = 50,000,000
- Average: 50,000,000 / 86,400 = about **579 views per second**
- Peak: 579 x 5 = about **2,900 views per second**

### Photo storage per year

- Per photo: 2 MB + 0.05 MB = 2.05 MB
- Per day: 1,000,000 x 2.05 MB = 2,050,000 MB = about 2.05 TB
- Per year: 2.05 TB x 365 = about **748 TB** (roughly 0.75 PB)
- Of this, originals are about 730 TB and thumbnails about 18 TB.

## Read-heavy or write-heavy?

SnapShare is **read-heavy**. There are 50 million feed views a day against 1 million uploads, a ratio of about 50 reads to 1 write.

What this means for the design:

- Optimise the read path first: cache feeds, serve photos from a CDN, and send reads to a read replica.
- Writes are few (about 12 per second), so a single primary database can handle them.
- Reads can be scaled by adding more cache, replicas and app servers.

## Why photos do not go in the database

- Photos are large binary files, 2 MB each, and 748 TB a year would make the database huge, slow and expensive to back up.
- Database storage costs more per GB than file storage, and photos need no joins or queries.
- Serving image bytes through the database would use up connections the feed queries need.

Photos go in **object storage** (such as Amazon S3). The database keeps only a small row for each photo, with the owner, the caption and the **key (path) of the file** in object storage.

## Architecture diagram

    Users (mobile app / browser)
             |
             v
       +-----------+   cache miss   +------------------+
       |    CDN    |--------------->|  Object storage  |
       +-----------+                |  (photo files)   |
             |                      +------------------+
             v                         ^           ^
    +-----------------+                |           | thumbnail saved
    |  Load balancer  |                |           |
    +-----------------+                |     +-----------+
             |                         |     |  Worker   |
             v                         |     | (resizes) |
    +-----------------+   original     |     +-----------+
    |  App servers    |----------------+           ^
    |  (stateless xN) |                            | takes job
    +-----------------+                      +-----------+
      |       |      |    adds upload job     |   Queue   |
      |       |      +----------------------->|           |
      |       |                               +-----------+
      |       v
      |   +-----------+  replication   +--------------+
      |   | Database  |--------------->| Read replica |
      |   | (primary) |                +--------------+
      |   +-----------+
      v
    +-----------+
    |   Cache   |
    |  (Redis)  |
    +-----------+

- Writes (new photo rows) go to the primary database.
- Feed reads check the cache first, then the read replica.

## What each component does

- **CDN:** serves photos and thumbnails from servers close to the user, so images load fast and the origin is not overloaded.
- **Load balancer:** spreads incoming requests across many app servers so no single server is overwhelmed, and removes servers that fail.
- **App servers:** run the application logic (login, upload, feed) and are stateless, so more can be added as traffic grows.
- **Cache:** keeps recently built feeds in memory so the same feed is not rebuilt from the database for every view.
- **Database (primary):** stores users, follows and photo records, and is the single place where writes happen.
- **Read replica:** a copy of the database that answers read queries, which takes load off the primary.
- **Object storage:** stores the large photo files cheaply and reliably, and scales to hundreds of terabytes.
- **Queue:** holds thumbnail jobs so uploads can finish quickly without waiting for image processing.
- **Worker:** takes jobs from the queue, creates the 50 KB thumbnail and saves it, so slow work happens in the background.

## Upload flow

1. The user picks a photo and the app sends it to SnapShare.
2. The request passes through the load balancer, which picks an app server.
3. The app server checks that the user is logged in and that the file is a valid image of an allowed size.
4. The app server saves the original photo to object storage.
5. The app server inserts a row in the primary database with the owner, the file key and the status "processing".
6. The app server adds a "create thumbnail" job to the queue.
7. The app server replies "201 Created" straight away, so the user does not wait for the thumbnail.
8. A worker takes the job from the queue, reads the original from object storage and creates a 50 KB thumbnail.
9. The worker saves the thumbnail to object storage and updates the database row to "ready".
10. The old cached feeds of the user's followers are cleared or updated, so the new photo appears, and the CDN serves its thumbnail.

## Trade-offs

- **Caching: speed vs freshness.** Cached feeds make reads very fast, but they can be slightly out of date, and clearing the cache correctly is hard. A follower might see a new photo a few seconds late.
- **Read replica: scale vs consistency.** The replica copies data from the primary with a small delay (replication lag). A user could upload a photo and not see it right away. One fix is to read a user's own recent uploads from the primary.
- **Queue and worker: fast uploads vs instant thumbnails.** Uploads respond quickly, but the thumbnail is not ready for a moment, so the app shows a placeholder until the job finishes. It also adds more parts to run and monitor.
- **CDN and object storage: performance vs cost.** About 748 TB a year plus CDN traffic is expensive. Old or rarely viewed photos could move to cheaper storage, at the price of slower access.