# Production Roadmap

## Phase 1: Multi-user foundation
- Add sign up, log in, log out.
- Store users, profiles, projects, clips, and exports in a database.
- Keep each project private to the owning user.

## Phase 2: UI chrome
- Add a sticky top nav with avatar and account actions.
- Add a settings panel for profile edits and preferences.
- Add reserved ad placeholders at the bottom and after export.

## Phase 3: Background processing
- Move FFmpeg work into a job queue.
- Track job progress and render history.
- Show live job status in the UI.

## Phase 4: Production deployment
- Run the web app and worker as separate services.
- Use PostgreSQL and S3-compatible storage.
- Add HTTPS, rate limiting, and secret management.

## Phase 5: Ads and monetization
- Start with static affiliate placements.
- Add AdSense only after the site has content, traffic, and policy pages.
- Keep ad slots optional and non-blocking.
