#!/bin/bash
set -e

echo "=== Post-merge setup ==="

# Install Python dependencies
echo "Installing Python dependencies..."
pip install -r backend/requirements.txt --quiet

# Check if frontend source changed
if git diff HEAD~1 HEAD --name-only 2>/dev/null | grep -q "^frontend/src\|^frontend/public\|^frontend/package.json\|^frontend/craco.config"; then
  echo "Frontend source changed, rebuilding..."
  cd frontend
  GENERATE_SOURCEMAP=false npx craco build
  cd ..
  cp -r frontend/build/* backend/static/
  echo "Frontend rebuilt and copied."
else
  echo "No frontend source changes, skipping build."
fi

echo "=== Post-merge setup complete ==="
