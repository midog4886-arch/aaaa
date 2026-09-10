"""Exercise multipart parsing (direct handler calls bypass this validation).

Production FastAPI 0.110 recognizes List[UploadFile], but not Optional[List],
as a sequence. Simulate that detector as well as the installed newer version.
"""
import inspect
from typing import get_origin
from io import BytesIO

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.datastructures import FormData, UploadFile
from pydantic import TypeAdapter
from routes import whatsapp


@pytest.mark.parametrize("handler", [
    whatsapp.create_campaign,
    whatsapp.update_campaign,
    whatsapp.send_branch_cloud_bulk_media,
])
@pytest.mark.parametrize("legacy_detector", [False, True])
@pytest.mark.parametrize("count", [0, 1, 2])
def test_attachment_field_binds_as_a_list(handler, legacy_detector, count):
    field = inspect.signature(handler).parameters["attachments"]
    assert get_origin(field.annotation) is list
    if legacy_detector:
        # Exact collection decision made by FastAPI 0.110's body parser.
        # Optional[List] would take form.get() and fail list validation.
        form = FormData([
            ("attachments", UploadFile(BytesIO(b"test"), filename=f"{index}.png"))
            for index in range(count)
        ])
        value = form.getlist("attachments") if get_origin(field.annotation) is list else form.get("attachments")
        parsed = TypeAdapter(field.annotation).validate_python(value)
        assert [file.filename for file in parsed] == [f"{index}.png" for index in range(count)]
        return
    # Reuse the exact endpoint parameter, without executing business operations.
    async def receive(**kwargs):
        files = kwargs["attachments"]
        return {"names": [upload.filename for upload in files]}

    receive.__signature__ = inspect.Signature(parameters=[
        field.replace(kind=inspect.Parameter.KEYWORD_ONLY),
    ])
    app = FastAPI()
    app.post("/probe")(receive)
    with TestClient(app) as client:
        response = client.post("/probe", data={"name": "test"}, files=[
            ("attachments", (f"{index}.png", b"test-file", "image/png"))
            for index in range(count)
        ])
    assert response.status_code == 200, response.text
    assert response.json() == {"names": [f"{index}.png" for index in range(count)]}