# User guide

## Roles

| | Author | Editor | Admin |
| --- | :-: | :-: | :-: |
| Write and edit own drafts | ✓ | ✓ | ✓ |
| Submit for review | ✓ | ✓ | ✓ |
| Publish, schedule, unpublish, archive | | ✓ | ✓ |
| Edit or delete anyone's posts | | ✓ | ✓ |
| Moderate comments, manage categories | | ✓ | ✓ |
| Upload media | ✓ | ✓ | ✓ |
| Manage users | | | ✓ |

## Writing a post

1. Sign in at `/admin` and click **New post**.
2. Add a title, an optional summary, and write in the editor. Use the toolbar for headings, lists, quotes, code, links and images. Uploaded images are added to the media library automatically, and you'll be asked for alt text.
3. In the sidebar, choose a category, tags, language, and whether to feature it on the home page.
4. Pick a cover image from the media library if you like.
5. Click **Save draft**.

## Getting it published

- **Authors:** click **Submit for review**. The post appears in editors' *Waiting for review* list on the dashboard.
- **Editors and admins:** click **Publish now**, or set a date and time and click **Schedule**. Times are entered in your local time zone.
- To take a post down, use **Unpublish** (back to draft) or **Archive**.

## SEO

Open the **SEO** panel under the editor. Set a meta title, meta description and focus keyword. After each save you get a score out of 100 with a list of what passed and what to fix, plus a preview of how the post looks in search results.

## History and restoring

Every save is kept. Click **History** in the Publish box to see all versions with who saved them and any change note. Choose a version and click **Restore this version**; your current text is kept in history too.

## Comments

Readers can comment on posts that allow it. New comments wait in **Comments → Pending**. Approve, mark as spam, or delete them.

## Media library

Upload JPG, PNG, GIF, WebP or PDF files up to 3 MB. Add alt text for images. Use **Copy link** to paste a file's URL anywhere.

## Content API

Any app can read published content:

- `GET /api/posts?page=1&limit=10&category=finance&tag=fintech&lang=en`
- `GET /api/posts/:slug` (full content plus related posts)
- `GET /api/categories`
