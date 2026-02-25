#!/bin/bash
cd /home/runner/workspace/backend
exec python -m uvicorn main:app --host 0.0.0.0 --port 5000
