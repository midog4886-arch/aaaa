from pydantic import BaseModel
from typing import Optional

class ProductCreate(BaseModel):
    name_ar: str
    name: Optional[str] = ""
    category: str = "swimming"
    sku: Optional[str] = ""
    price: float
    cost: float = 0
    quantity: int = 0
    min_quantity: int = 5
    description: Optional[str] = ""

class Product(BaseModel):
    id: str
    name_ar: str
    name: Optional[str] = ""
    category: str
    sku: str
    price: float
    cost: float
    quantity: int
    min_quantity: int
    description: Optional[str] = ""
    branch_id: Optional[str] = None
    created_at: str
    updated_at: str
