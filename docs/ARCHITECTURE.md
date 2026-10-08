# Architecture

Pressroom is a **layered MVC monolith** with a **headless API** alongside the server-rendered site. One Node.js process serves three surfaces from one MongoDB database.

```
            Readers                 Editors / Authors            Other front ends
               │                           │                            │
        GET /, /post/:slug           /admin/* (forms)               GET /api/*
               │                           │                            │
┌──────────────▼───────────────────────────▼────────────────────────────▼──────────┐
│ Express app (src/app.js)                                                          │
│  Helmet CSP · compression · body parsing · NoSQL-operator stripping · sessions    │
│  loadUser → flash → CSRF (forms only)                                             │
│ ┌───────────────┐   ┌────────────────────────┐   ┌──────────────────────────────┐ │
│ │ routes/public │   │ routes/admin           │   │ routes/api (read-only, CORS) │ │
│ └──────┬────────┘   └──────────┬─────────────┘   └──────────────┬───────────────┘ │
│        │      services: workflow · posts · seo · recommend · cache               │
│        └───────────────────────┼──────────────────────────────────┘               │
│                        Mongoose models                                            │
└────────────────────────────────┼──────────────────────────────────────────────────┘
                                 ▼
          MongoDB: users · posts · revisions · categories · comments · media · pageviews · sessions
```

## Data model

| Collection | Key fields | Notes |
| --- | --- | --- |
| `users` | name, email (unique), passwordHash, role, active | Roles map to a permission matrix in `models/User.js`. |
| `posts` | title, slug (unique), content (sanitised HTML), status, publishAt, publishedAt, author, category, tags[], lang, seo{}, views, version | Indexes on status+publishedAt, tags, category+status. |
| `revisions` | post, version, snapshot of editable fields, editedBy, note | One per save; powers history and rollback. |
| `categories` | name, slug, description | Slug generated from name. |
| `comments` | post, name, email, body, status | `pending` until approved. |
| `media` | filename, mimeType, size, alt, data (Buffer) | Binary excluded from queries by default. |
| `pageviews` | post, day (YYYY-MM-DD), count | Unique on post+day; one upsert per view. |
| `sessions` | managed by connect-mongo | TTL-expired after 7 days. |

## Key design decisions

**Workflow as data.** Allowed status changes live in one table (`services/workflow.js`) mapping *from → to → required permission*. Routes ask `canTransition(user, post, to)`, and the editor only shows buttons from `allowedTargets()`. Adding a state means editing one table.

**Snapshots over diffs for versions.** Each save stores the full editable content. It costs a little storage but makes restore trivial and safe, and a restore is itself saved as a new version, so history is append-only.

**Scheduling without a job queue.** A scheduled post is public as soon as `publishAt` passes, because the public "live" query (`Post.liveFilter`) includes due scheduled posts. A once-a-minute job then flips them to `published` to keep counts tidy. This stays correct even if the process sleeps (Render free tier).

**Caching.** Public list pages, the sidebar, the sitemap and API lists go through a small TTL cache. Every content write clears it, so editors never see stale pages after saving.

**Media in the database.** Render's free disk is wiped on restart, so files are stored in MongoDB and served with year-long immutable cache headers. Uploads are capped at 3 MB and verified by magic bytes.

**Security in depth.** Input is cleaned (operator stripping), content is sanitised on write and escaped on render, CSP blocks injected scripts as a last line, and every state-changing form needs a CSRF token.

## Request flow: publishing a post

1. Editor submits the form with `action=publish` and a CSRF token.
2. CSRF middleware validates the token; `loadPost` checks the user may edit this post.
3. `workflow.canTransition` confirms the role may move it to *published*.
4. `posts.updatePost` sanitises HTML, recalculates reading time, bumps the version, saves, writes a revision, and clears the cache.
5. Redirect back to the editor, which re-runs the SEO analyser and shows the score.
