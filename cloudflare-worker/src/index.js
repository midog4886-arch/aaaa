import { MongoClient } from "mongodb";

let client = null;
let db = null;

async function getDb(mongoUrl) {
  if (db) return db;
  client = new MongoClient(mongoUrl, {
    serverSelectionTimeoutMS: 30000,
    connectTimeoutMS: 30000,
    socketTimeoutMS: 30000,
  });
  await client.connect();
  db = client.db("champions_academy");
  return db;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-api-key",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (path === "/health") {
      return new Response(JSON.stringify({ status: "ok", service: "mongodb-proxy" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = request.headers.get("x-api-key");
    if (apiKey !== env.PROXY_API_KEY) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!path.startsWith("/action/")) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const action = path.replace("/action/", "");
    const body = await request.json();

    try {
      const database = await getDb(env.MONGO_URL);
      const collection = database.collection(body.collection);
      let result;

      if (action === "findOne") {
        result = await collection.findOne(body.filter || {}, { projection: body.projection || {} });
        return new Response(JSON.stringify({ document: result }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } else if (action === "find") {
        let cursor = collection.find(body.filter || {}, { projection: body.projection || {} });
        if (body.sort) cursor = cursor.sort(body.sort);
        if (body.skip) cursor = cursor.skip(body.skip);
        if (body.limit) cursor = cursor.limit(body.limit);
        const docs = await cursor.toArray();
        return new Response(JSON.stringify({ documents: docs }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } else if (action === "insertOne") {
        result = await collection.insertOne(body.document || {});
        return new Response(JSON.stringify({ insertedId: result.insertedId, acknowledged: result.acknowledged }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } else if (action === "updateOne") {
        result = await collection.updateOne(body.filter || {}, body.update || {}, body.options || {});
        return new Response(JSON.stringify({ matchedCount: result.matchedCount, modifiedCount: result.modifiedCount, upsertedId: result.upsertedId }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } else if (action === "updateMany") {
        result = await collection.updateMany(body.filter || {}, body.update || {}, body.options || {});
        return new Response(JSON.stringify({ matchedCount: result.matchedCount, modifiedCount: result.modifiedCount }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } else if (action === "deleteOne") {
        result = await collection.deleteOne(body.filter || {});
        return new Response(JSON.stringify({ deletedCount: result.deletedCount }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } else if (action === "deleteMany") {
        result = await collection.deleteMany(body.filter || {});
        return new Response(JSON.stringify({ deletedCount: result.deletedCount }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } else if (action === "countDocuments") {
        result = await collection.countDocuments(body.filter || {});
        return new Response(JSON.stringify({ count: result }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } else if (action === "aggregate") {
        const docs = await collection.aggregate(body.pipeline || []).toArray();
        return new Response(JSON.stringify({ documents: docs }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } else if (action === "distinct") {
        result = await collection.distinct(body.field, body.filter || {});
        return new Response(JSON.stringify({ values: result }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } else {
        return new Response(JSON.stringify({ error: "Unknown action: " + action }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } catch (err) {
      console.error("MongoDB error:", err);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};
