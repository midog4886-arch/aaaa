"""
MongoDB HTTP Proxy
Implements Atlas Data API-compatible endpoints over HTTPS.
Deploy to Hugging Face Spaces - allows port 27017 outbound.
"""
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient, ASCENDING, DESCENDING
from bson import ObjectId
import os
from datetime import datetime, timezone

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

MONGO_URL = os.environ.get("MONGO_URL", "")
PROXY_API_KEY = os.environ.get("PROXY_API_KEY", "champions-proxy-key-2024")

_client = None


def get_client():
    global _client
    if not MONGO_URL:
        raise Exception("MONGO_URL environment variable is not set")
    if _client is None:
        _client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=15000)
    return _client


def parse_ejson(value):
    if isinstance(value, dict):
        if "$oid" in value:
            try:
                return ObjectId(value["$oid"])
            except Exception:
                return value["$oid"]
        if "$date" in value:
            d = value["$date"]
            if isinstance(d, dict) and "$numberLong" in d:
                return datetime.fromtimestamp(int(d["$numberLong"]) / 1000, tz=timezone.utc).replace(tzinfo=None)
            if isinstance(d, (int, float)):
                return datetime.fromtimestamp(d / 1000, tz=timezone.utc).replace(tzinfo=None)
            return d
        if "$numberLong" in value:
            return int(value["$numberLong"])
        if "$numberInt" in value:
            return int(value["$numberInt"])
        if "$numberDouble" in value:
            return float(value["$numberDouble"])
        return {k: parse_ejson(v) for k, v in value.items()}
    if isinstance(value, list):
        return [parse_ejson(item) for item in value]
    return value


def to_ejson(value):
    if isinstance(value, ObjectId):
        return {"$oid": str(value)}
    if isinstance(value, datetime):
        return {"$date": {"$numberLong": str(int(value.timestamp() * 1000))}}
    if isinstance(value, dict):
        return {k: to_ejson(v) for k, v in value.items()}
    if isinstance(value, list):
        return [to_ejson(item) for item in value]
    return value


def clean_doc(doc):
    if doc is None:
        return None
    doc.pop("_id", None)
    return doc


@app.get("/health")
async def health():
    mongo_configured = bool(MONGO_URL)
    return {
        "status": "ok",
        "mongo_configured": mongo_configured,
        "version": "1.1"
    }


@app.post("/action/{action}")
async def handle_action(action: str, request: Request, api_key: str = Header(None)):
    if api_key != PROXY_API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")

    body = await request.json()
    db_name = body.get("database")
    if not db_name:
        raise HTTPException(status_code=400, detail="Missing 'database' in request body")
    col_name = body.get("collection", "")
    if not col_name:
        raise HTTPException(status_code=400, detail="Missing 'collection' in request body")

    try:
        client = get_client()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Database not configured: {e}")

    col = client[db_name][col_name]

    try:
        if action == "findOne":
            filter_ = parse_ejson(body.get("filter", {}))
            projection = body.get("projection")
            doc = col.find_one(filter_, projection)
            clean_doc(doc)
            return {"document": to_ejson(doc) if doc else None}

        elif action == "find":
            filter_ = parse_ejson(body.get("filter", {}))
            projection = body.get("projection")
            sort = body.get("sort")
            limit = body.get("limit", 0)
            skip = body.get("skip", 0)
            cursor = col.find(filter_, projection).skip(skip).limit(limit)
            if sort:
                sort_list = [(k, ASCENDING if v == 1 else DESCENDING) for k, v in sort.items()]
                cursor = cursor.sort(sort_list)
            docs = list(cursor)
            for doc in docs:
                clean_doc(doc)
            return {"documents": [to_ejson(d) for d in docs]}

        elif action == "insertOne":
            doc = parse_ejson(body.get("document", {}))
            doc.pop("_id", None)
            result = col.insert_one(doc)
            return {"insertedId": str(result.inserted_id)}

        elif action == "insertMany":
            docs = [parse_ejson(d) for d in body.get("documents", [])]
            for d in docs:
                d.pop("_id", None)
            result = col.insert_many(docs)
            return {"insertedIds": [str(i) for i in result.inserted_ids]}

        elif action == "updateOne":
            filter_ = parse_ejson(body.get("filter", {}))
            update = parse_ejson(body.get("update", {}))
            upsert = body.get("upsert", False)
            result = col.update_one(filter_, update, upsert=upsert)
            return {
                "matchedCount": result.matched_count,
                "modifiedCount": result.modified_count,
                "upsertedId": str(result.upserted_id) if result.upserted_id else None
            }

        elif action == "updateMany":
            filter_ = parse_ejson(body.get("filter", {}))
            update = parse_ejson(body.get("update", {}))
            upsert = body.get("upsert", False)
            result = col.update_many(filter_, update, upsert=upsert)
            return {"matchedCount": result.matched_count, "modifiedCount": result.modified_count}

        elif action == "deleteOne":
            filter_ = parse_ejson(body.get("filter", {}))
            result = col.delete_one(filter_)
            return {"deletedCount": result.deleted_count}

        elif action == "deleteMany":
            filter_ = parse_ejson(body.get("filter", {}))
            result = col.delete_many(filter_)
            return {"deletedCount": result.deleted_count}

        elif action == "aggregate":
            pipeline = [parse_ejson(stage) for stage in body.get("pipeline", [])]
            docs = list(col.aggregate(pipeline))
            for doc in docs:
                clean_doc(doc)
            return {"documents": [to_ejson(d) for d in docs]}

        else:
            raise HTTPException(status_code=400, detail=f"Unknown action: {action}")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 7860))
    uvicorn.run(app, host="0.0.0.0", port=port)
