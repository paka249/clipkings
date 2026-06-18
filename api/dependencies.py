from api.models import User


def get_current_user() -> User:
    """Dummy dependency — returns a fixed test user so protected routes work without OAuth."""
    user = User()
    user.id                 = "00000000-test-0000-0000-000000000000"
    user.email              = "test@example.com"
    user.google_id          = None
    user.stripe_customer_id = None
    user.is_premium         = False
    return user
