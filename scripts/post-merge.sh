#!/bin/bash
set -e

echo "=== Post-merge setup ==="

# Install Python dependencies
echo "Installing Python dependencies..."
pip install -r backend/requirements.txt --quiet

# Detect changed files since the merge
CHANGED=$(git diff HEAD~1 HEAD --name-only 2>/dev/null || true)

# If frontend dependency manifest changed, install JS deps. We use
# --legacy-peer-deps because Capacitor pins an older react peer than the
# rest of the app (react 19) and would otherwise refuse to install.
if echo "$CHANGED" | grep -qE "^frontend/(package\.json|package-lock\.json|yarn\.lock)"; then
  echo "Frontend dependency manifest changed, installing JS deps..."
  (cd frontend && npm install --legacy-peer-deps --no-audit --no-fund)
fi

# Rebuild the bundled SPA whenever any frontend source or config changed.
if echo "$CHANGED" | grep -qE "^frontend/(src|public|package\.json|craco\.config)"; then
  echo "Frontend source changed, rebuilding..."
  # Make sure node_modules exists even if package.json itself didn't change
  # but a fresh checkout was created without dependencies installed.
  if [ ! -d frontend/node_modules ]; then
    echo "node_modules missing, installing JS deps..."
    (cd frontend && npm install --legacy-peer-deps --no-audit --no-fund)
  fi
  (cd frontend && GENERATE_SOURCEMAP=false NODE_OPTIONS="--max-old-space-size=6144" CI=false npx craco build)
  rm -rf backend/static
  cp -r frontend/build backend/static
  echo "Frontend rebuilt and copied."
else
  echo "No frontend source changes, skipping build."
fi

echo "=== Post-merge setup complete ==="
