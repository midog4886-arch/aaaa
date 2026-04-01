"""
Atlas Data API HTTP Client
Motor-compatible wrapper that uses HTTPS (port 443) instead of MongoDB native protocol (port 27017)
Used as a fallback when direct MongoDB connection is blocked.
"""
import httpx
import asyncio
import os
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger("atlas_http")

# ─── EJSON helpers ────────────────────────────────────────────────────────────

def _to_ejson(value):
    """Convert Python values → EJSON for Atlas Data API request body."""
    if isinstance(value, datetime):
        ts_ms = int(value.timestamp() * 1000)
        return {"$date": {"$numberLong": str(ts_ms)}}
    if isinstance(value, dict):
        return {k: _to_ejson(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_to_ejson(item) for item in value]
    return value


def _from_ejson(value):
    """Convert EJSON values → Python types from Atlas Data API response."""
    if isinstance(value, dict):
        if "$oid" in value:
            return str(value["$oid"])
        if "$date" in value:
            d = value["$date"]
            if isinstance(d, dict) and "$numberLong" in d:
                ts_ms = int(d["$numberLong"])
                return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).replace(tzinfo=None)
            if isinstance(d, (int, float)):
                return datetime.fromtimestamp(d / 1000, tz=timezone.utc).replace(tzinfo=None)
            return d
        if "$numberLong" in value:
            return int(value["$numberLong"])
        if "$numberInt" in value:
            return int(value["$numberInt"])
        if "$numberDouble" in value:
            return float(value["$numberDouble"])
        return {k: _from_ejson(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_from_ejson(item) for item in value]
    return value


# ─── Cursor classes ───────────────────────────────────────────────────────────

class AtlasCursor:
    """Mimics Motor AsyncCursor — supports .sort(), .limit(), .skip(), .to_list()"""

    def __init__(self, collection, filter_=None, projection=None):
        self._col = collection
        self._filter = filter_ or {}
        self._projection = projection
        self._sort_spec = None
        self._limit_val = 0
        self._skip_val = 0

    def sort(self, key_or_list, direction=None):
        if isinstance(key_or_list, list):
            self._sort_spec = {k: v for k, v in key_or_list}
        elif isinstance(key_or_list, dict):
            self._sort_spec = key_or_list
        else:
            self._sort_spec = {key_or_list: direction if direction is not None else 1}
        return self

    def limit(self, n):
        self._limit_val = n
        return self

    def skip(self, n):
        self._skip_val = n
        return self

    async def to_list(self, length=None):
        payload = {"filter": _to_ejson(self._filter)}
        if self._projection:
            payload["projection"] = self._projection
        if self._sort_spec:
            payload["sort"] = self._sort_spec
        effective_limit = length if length is not None else self._limit_val
        if effective_limit:
            payload["limit"] = effective_limit
        if self._skip_val:
            payload["skip"] = self._skip_val
        result = await self._col._request("find", payload)
        return [_from_ejson(doc) for doc in result.get("documents", [])]

    def __aiter__(self):
        self._iter_cache = None
        return self

    async def __anext__(self):
        if self._iter_cache is None:
            self._iter_cache = await self.to_list(None)
            self._iter_index = 0
        if self._iter_index >= len(self._iter_cache):
            raise StopAsyncIteration
        doc = self._iter_cache[self._iter_index]
        self._iter_index += 1
        return doc


class AtlasAggregateCursor:
    """Mimics Motor AsyncCommandCursor for aggregate()."""

    def __init__(self, collection, pipeline):
        self._col = collection
        self._pipeline = pipeline

    async def to_list(self, length=None):
        result = await self._col._request("aggregate", {"pipeline": _to_ejson(self._pipeline)})
        docs = result.get("documents", [])
        return [_from_ejson(doc) for doc in docs]

    def __aiter__(self):
        self._iter_cache = None
        return self

    async def __anext__(self):
        if self._iter_cache is None:
            self._iter_cache = await self.to_list(None)
            self._iter_index = 0
        if self._iter_index >= len(self._iter_cache):
            raise StopAsyncIteration
        doc = self._iter_cache[self._iter_index]
        self._iter_index += 1
        return doc


# ─── Result stubs ─────────────────────────────────────────────────────────────

class _InsertOneResult:
    def __init__(self, inserted_id): self.inserted_id = inserted_id

class _InsertManyResult:
    def __init__(self, inserted_ids): self.inserted_ids = inserted_ids

class _UpdateResult:
    def __init__(self, matched, modified, upserted_id=None):
        self.matched_count = matched
        self.modified_count = modified
        self.upserted_id = upserted_id

class _DeleteResult:
    def __init__(self, deleted): self.deleted_count = deleted


# ─── Collection ───────────────────────────────────────────────────────────────

class AtlasCollection:
    def __init__(self, db, name):
        self._db = db
        self._name = name

    async def _request(self, action: str, payload: dict) -> dict:
        url = f"{self._db._client._base_url}/action/{action}"
        body = {
            "dataSource": self._db._client._data_source,
            "database": self._db._name,
            "collection": self._name,
            **payload,
        }
        headers = {
            "api-key": self._db._client._api_key,
            "Content-Type": "application/ejson",
            "Accept": "application/ejson",
        }
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, json=body, headers=headers)
            if resp.status_code >= 400:
                logger.error(f"Atlas API {action} error {resp.status_code}: {resp.text[:300]}")
                raise Exception(f"Atlas API error {resp.status_code}: {resp.text[:200]}")
            return resp.json()

    async def find_one(self, filter_=None, projection=None):
        payload = {"filter": _to_ejson(filter_ or {})}
        if projection:
            payload["projection"] = projection
        result = await self._request("findOne", payload)
        doc = result.get("document")
        return _from_ejson(doc) if doc else None

    def find(self, filter_=None, projection=None):
        return AtlasCursor(self, filter_ or {}, projection)

    async def insert_one(self, document):
        result = await self._request("insertOne", {"document": _to_ejson(document)})
        return _InsertOneResult(result.get("insertedId"))

    async def insert_many(self, documents):
        result = await self._request("insertMany", {"documents": [_to_ejson(d) for d in documents]})
        return _InsertManyResult(result.get("insertedIds", []))

    async def update_one(self, filter_, update, upsert=False):
        payload = {"filter": _to_ejson(filter_), "update": _to_ejson(update), "upsert": upsert}
        result = await self._request("updateOne", payload)
        return _UpdateResult(
            result.get("matchedCount", 0),
            result.get("modifiedCount", 0),
            result.get("upsertedId"),
        )

    async def update_many(self, filter_, update, upsert=False):
        payload = {"filter": _to_ejson(filter_), "update": _to_ejson(update), "upsert": upsert}
        result = await self._request("updateMany", payload)
        return _UpdateResult(result.get("matchedCount", 0), result.get("modifiedCount", 0))

    async def delete_one(self, filter_):
        result = await self._request("deleteOne", {"filter": _to_ejson(filter_)})
        return _DeleteResult(result.get("deletedCount", 0))

    async def delete_many(self, filter_):
        result = await self._request("deleteMany", {"filter": _to_ejson(filter_)})
        return _DeleteResult(result.get("deletedCount", 0))

    async def count_documents(self, filter_=None):
        pipeline = [{"$match": _to_ejson(filter_ or {})}, {"$count": "n"}]
        result = await self._request("aggregate", {"pipeline": pipeline})
        docs = result.get("documents", [])
        return int(docs[0]["n"]) if docs else 0

    def aggregate(self, pipeline):
        return AtlasAggregateCursor(self, pipeline)

    async def find_one_and_update(self, filter_, update, return_document=False, upsert=False, projection=None):
        if return_document:
            await self.update_one(filter_, update, upsert=upsert)
            merged_filter = {**_to_ejson(filter_)}
            if "$set" in update:
                for k, v in update["$set"].items():
                    merged_filter[k] = _to_ejson(v)
            return await self.find_one(merged_filter, projection)
        else:
            doc = await self.find_one(filter_, projection)
            await self.update_one(filter_, update, upsert=upsert)
            return doc

    async def create_index(self, *args, **kwargs):
        pass  # No-op (indexes managed in Atlas UI)

    async def drop(self):
        pass  # Safety: not supported via Data API


# ─── Database ─────────────────────────────────────────────────────────────────

class AtlasDatabase:
    def __init__(self, client, name):
        self._client = client
        self._name = name
        self._collections: Dict[str, AtlasCollection] = {}

    def __getattr__(self, name: str):
        if name.startswith("_"):
            raise AttributeError(name)
        return self[name]

    def __getitem__(self, name: str) -> AtlasCollection:
        if name not in self._collections:
            self._collections[name] = AtlasCollection(self, name)
        return self._collections[name]


# ─── Client ───────────────────────────────────────────────────────────────────

class AtlasClient:
    def __init__(self, app_id: str, api_key: str, data_source: str = "Cluster0"):
        self._app_id = app_id
        self._api_key = api_key
        self._data_source = data_source
        self._base_url = f"https://data.mongodb-api.com/app/{app_id}/endpoint/data/v1"
        self._databases: Dict[str, AtlasDatabase] = {}

    def __getitem__(self, name: str) -> AtlasDatabase:
        if name not in self._databases:
            self._databases[name] = AtlasDatabase(self, name)
        return self._databases[name]
