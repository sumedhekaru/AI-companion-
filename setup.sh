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

# Create models directory
echo "📁 Creating models directory..."
mkdir -p code/models

# Download Vosk model
echo "⬇️  Downloading Vosk model (this may take a minute)..."
cd code/models
curl -L -o vosk-model-small-en-us-0.15.zip https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip
unzip vosk-model-small-en-us-0.15.zip
rm vosk-model-small-en-us-0.15.zip
cd ../..

echo "✅ Setup complete!"
echo ""
echo "🎤 To start the application:"
echo "   cd code"
echo "   source ../venv/bin/activate"
echo "   python main.py"
echo ""
echo "🌐 Then open: http://localhost:8000"
