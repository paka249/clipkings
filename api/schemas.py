from pydantic import BaseModel, EmailStr


class UserCreate(BaseModel):
    email: EmailStr
    google_id: str | None = None
    stripe_customer_id: str | None = None
    is_premium: bool = False


class UserOut(BaseModel):
    id: str
    email: str
    google_id: str | None
    stripe_customer_id: str | None
    is_premium: bool

    model_config = {"from_attributes": True}
