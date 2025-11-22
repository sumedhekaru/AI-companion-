#!/bin/bash

# AI Companion Setup Script
echo "🚀 Setting up AI Companion..."

# Create virtual environment
echo "📦 Creating virtual environment..."
python3 -m venv venv
source venv/bin/activate

# Install dependencies
echo "📥 Installing dependencies..."
pip install -r requirements.txt

echo "✅ Setup complete!"
echo ""
echo "🎤 To start the application:"
echo "   cd code"
echo "   source ../venv/bin/activate"
echo "   python main.py"
echo ""
echo "🌐 Then open: http://localhost:8001"
