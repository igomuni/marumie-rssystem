#!/bin/bash
# Decompress gzipped data files for build process

set -e

echo "📦 Decompressing data files..."

DATA_DIR="public/data"

# Check if compressed files exist
if [ ! -f "$DATA_DIR/rs2024-structured.json.gz" ]; then
  echo "❌ Error: $DATA_DIR/rs2024-structured.json.gz not found"
  exit 1
fi

if [ ! -f "$DATA_DIR/rs2024-project-details.json.gz" ]; then
  echo "❌ Error: $DATA_DIR/rs2024-project-details.json.gz not found"
  exit 1
fi

# Decompress rs2024-structured.json if needed
if [ ! -f "$DATA_DIR/rs2024-structured.json" ] || [ "$DATA_DIR/rs2024-structured.json.gz" -nt "$DATA_DIR/rs2024-structured.json" ]; then
  echo "🔓 Decompressing rs2024-structured.json.gz..."
  gunzip -k -f "$DATA_DIR/rs2024-structured.json.gz"
  echo "✅ Decompression complete ($(du -h "$DATA_DIR/rs2024-structured.json" | cut -f1))"
else
  echo "✅ rs2024-structured.json already exists and is up to date"
fi

# Decompress rs2024-project-details.json if needed
if [ ! -f "$DATA_DIR/rs2024-project-details.json" ] || [ "$DATA_DIR/rs2024-project-details.json.gz" -nt "$DATA_DIR/rs2024-project-details.json" ]; then
  echo "🔓 Decompressing rs2024-project-details.json.gz..."
  gunzip -k -f "$DATA_DIR/rs2024-project-details.json.gz"
  echo "✅ Decompression complete ($(du -h "$DATA_DIR/rs2024-project-details.json" | cut -f1))"
else
  echo "✅ rs2024-project-details.json already exists and is up to date"
fi

# Decompress project-quality-recipients.json if needed
if [ -f "$DATA_DIR/project-quality-recipients.json.gz" ]; then
  if [ ! -f "$DATA_DIR/project-quality-recipients.json" ] || [ "$DATA_DIR/project-quality-recipients.json.gz" -nt "$DATA_DIR/project-quality-recipients.json" ]; then
    echo "🔓 Decompressing project-quality-recipients.json.gz..."
    gunzip -k -f "$DATA_DIR/project-quality-recipients.json.gz"
    echo "✅ Decompression complete ($(du -h "$DATA_DIR/project-quality-recipients.json" | cut -f1))"
  else
    echo "✅ project-quality-recipients.json already exists and is up to date"
  fi
fi

echo "✅ All data files ready"
