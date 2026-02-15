#!/bin/bash

# 🏆 Champions Academy - Build Script

echo "🔨 Building Champions Academy..."

# Build Frontend
echo "📦 Building Frontend..."
cd frontend
npm install
npm run build
cd ..

# Copy build to backend static folder
echo "📁 Copying build files..."
mkdir -p backend/static
cp -r frontend/build/* backend/static/

# Install backend dependencies
echo "🐍 Installing Backend dependencies..."
cd backend
pip install -r requirements.txt
cd ..

echo "✅ Build complete!"
echo ""
echo "To run locally:"
echo "  cd backend && uvicorn server:app --host 0.0.0.0 --port 8000"
echo ""
echo "Then open: http://localhost:8000"
