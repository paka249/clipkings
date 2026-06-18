# Deployment Notes

## Minimum viable production setup
- Web app: Streamlit or FastAPI-based UI.
- Database: PostgreSQL.
- Queue: Redis + RQ or Celery.
- Worker: FFmpeg renderer in a separate process.
- Storage: S3 or compatible object storage for exports.

## Hosting options
- Fastest path: Railway or Render.
- More control: DigitalOcean VPS.
- Heavier scale: AWS ECS or EC2 + RDS + S3.

## Security checklist
- Hash passwords with a slow hash.
- Force HTTPS.
- Store secrets in environment variables.
- Scope every query by user_id.
- Use signed download URLs.
- Run FFmpeg in a sandboxed worker if possible.

## Practical scaling note
This app should not render inside the web request path once real users are on it. Use a job queue and return job status to the UI instead.
