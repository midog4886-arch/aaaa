import uuid
from datetime import date, time
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


WEEKDAYS = {
    "saturday", "sunday", "monday", "tuesday",
    "wednesday", "thursday", "friday",
}


class BookingSlot(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    day: str
    start_time: str
    end_time: str
    start_date: str
    end_date: str
    cost: float = Field(ge=0)
    cost_type: str = Field(min_length=1, max_length=50)

    @field_validator("id", "day", "start_time", "end_time", "start_date", "end_date", "cost_type")
    @classmethod
    def strip_strings(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be empty")
        return value

    @field_validator("day")
    @classmethod
    def valid_day(cls, value: str) -> str:
        value = value.lower()
        if value not in WEEKDAYS:
            raise ValueError("day must be a valid English weekday id")
        return value

    @field_validator("start_time", "end_time")
    @classmethod
    def valid_time(cls, value: str) -> str:
        try:
            parsed = time.fromisoformat(value)
        except ValueError as exc:
            raise ValueError("time must use HH:MM format") from exc
        if parsed.second or parsed.microsecond:
            raise ValueError("time must use HH:MM format")
        return parsed.strftime("%H:%M")

    @field_validator("start_date", "end_date")
    @classmethod
    def valid_date(cls, value: str) -> str:
        try:
            return date.fromisoformat(value).isoformat()
        except ValueError as exc:
            raise ValueError("date must use YYYY-MM-DD format") from exc

    @model_validator(mode="after")
    def valid_window(self):
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be later than start_time")
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class VenueCourt(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str = Field(min_length=1, max_length=200)
    number: Optional[str] = Field(default="", max_length=100)
    size: str = Field(min_length=1, max_length=100)
    contract_start_date: Optional[str] = ""
    contract_end_date: Optional[str] = ""
    cost: Optional[float] = Field(default=None, ge=0)
    cost_type: Optional[str] = Field(default="")
    warning_days: int = Field(default=30, ge=0, le=3650)
    booking_slots: List[BookingSlot] = Field(default_factory=list)

    @field_validator("id", "name", "size")
    @classmethod
    def strip_strings(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be empty")
        return value

    @field_validator("contract_start_date", "contract_end_date")
    @classmethod
    def valid_optional_date(cls, value: str) -> str:
        value = (value or "").strip()
        if not value:
            return ""
        try:
            return date.fromisoformat(value).isoformat()
        except ValueError as exc:
            raise ValueError("date must use YYYY-MM-DD format") from exc

    @model_validator(mode="after")
    def validate_slots(self):
        if self.contract_start_date and self.contract_end_date and self.contract_end_date < self.contract_start_date:
            raise ValueError("contract_end_date must be on or after contract_start_date")
        seen_ids = set()
        for slot in self.booking_slots:
            if slot.id in seen_ids:
                raise ValueError(f"duplicate booking slot id: {slot.id}")
            seen_ids.add(slot.id)

        for index, left in enumerate(self.booking_slots):
            for right in self.booking_slots[index + 1:]:
                same_day = left.day == right.day
                dates_overlap = left.start_date <= right.end_date and right.start_date <= left.end_date
                times_overlap = left.start_time < right.end_time and right.start_time < left.end_time
                if same_day and dates_overlap and times_overlap:
                    raise ValueError(
                        f"booking slots {left.id} and {right.id} overlap for {left.day}"
                    )
        return self

class BranchBase(BaseModel):
    name: str
    name_ar: str
    public_name: Optional[str] = ""
    phone: str
    manager_name: Optional[str] = ""
    manager_name_ar: Optional[str] = ""
    address: Optional[str] = ""
    address_ar: Optional[str] = ""
    # Public Google-Maps (or similar) location link shown on the public
    # registration page. Empty -> hidden.
    location_url: Optional[str] = ""
    is_active: bool = True
    code_prefix: Optional[str] = ""
    whatsapp_group_url: Optional[str] = ""
    # Per-branch WhatsApp message templates. Empty -> fall back to the shared
    # global templates in whatsapp_settings (backward compatible).
    whatsapp_renewal_template: Optional[str] = ""
    whatsapp_manual_template: Optional[str] = ""
    whatsapp_manual_expired_template: Optional[str] = ""
    whatsapp_welcome_template: Optional[str] = ""
    # Days the branch operates. None/empty = open all week (backward compatible).
    working_days: Optional[List[str]] = None
    # Missing on all historical rows, so permanent remains the safe legacy default.
    branch_type: Literal["permanent", "rented", "rented_venue"] = "permanent"
    venues: List[VenueCourt] = Field(default_factory=list)
    contract_warning_days: int = Field(default=30, ge=0, le=3650)

    @model_validator(mode="after")
    def validate_rented_venues(self):
        if self.branch_type == "rented_venue":
            self.branch_type = "rented"
        venue_ids = [venue.id for venue in self.venues]
        if len(venue_ids) != len(set(venue_ids)):
            raise ValueError("venue ids must be unique")
        return self

class BranchCreate(BranchBase):
    pass

class Branch(BranchBase):
    id: str
    created_at: str
