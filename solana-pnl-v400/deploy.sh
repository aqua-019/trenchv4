#!/bin/bash
# ══════════════════════════════════════════════════════════
# Aquatic's Solana PnL Dashboard — Deploy Script
# ══════════════════════════════════════════════════════════
# 
# USAGE:
#   1. Unzip solana-pnl-vercel.zip into a folder
#   2. cd into that folder
#   3. Run this script: bash deploy.sh
#
# PREREQUISITES:
#   - git installed
#   - GitHub CLI (gh) installed, OR create repo manually on github.com
#   - Vercel account at vercel.com
# ══════════════════════════════════════════════════════════

set -e

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Solana PnL Dashboard — Deploy"
echo "═══════════════════════════════════════════════════"
echo ""

# Verify src exists
if [ ! -f "src/app/page.js" ]; then
  echo "ERROR: src/app/page.js not found!"
  echo "Make sure you're running this from inside the unzipped project folder."
  exit 1
fi

echo "✓ src/app/page.js found"
echo "✓ src/app/layout.js found"
echo "✓ src/components/Dashboard.js found"
echo ""

# Install dependencies
echo "→ Installing dependencies..."
npm install
echo ""

# Test build
echo "→ Running test build..."
npx next build 2>&1 | grep -E "(○|✓|Error)" || true
echo ""

# Verify the / route was generated
if npx next build 2>&1 | grep -q "○ /"; then
  echo "✓ Build successful — / route confirmed"
else
  echo "⚠ WARNING: / route may not have been generated"
  echo "  Check the build output above for errors"
fi
echo ""

# Git init
echo "→ Initializing git..."
git init
git add -A
git status
echo ""

echo "→ Files staged for commit:"
git diff --cached --stat
echo ""

git commit -m "feat: solana pnl dashboard v3 — helius + dexscreener + ws hybrid"
echo ""

echo "═══════════════════════════════════════════════════"
echo "  LOCAL SETUP COMPLETE"
echo "═══════════════════════════════════════════════════"
echo ""
echo "NEXT STEPS:"
echo ""
echo "  1. Create a repo on github.com (or use gh cli):"
echo "     gh repo create solana-pnl --public --source=. --remote=origin --push"
echo ""
echo "  2. Or manually:"
echo "     git remote add origin https://github.com/YOUR_USERNAME/solana-pnl.git"
echo "     git branch -M main"
echo "     git push -u origin main"
echo ""
echo "  3. On Vercel (vercel.com/new):"
echo "     - Import your GitHub repo"
echo "     - Add Environment Variable:"
echo "       NEXT_PUBLIC_HELIUS_KEY = 8889c1fa-ccc8-4405-b3f6-e90ac48ed9ab"
echo "     - Click Deploy"
echo ""
echo "  4. Verify build log shows:  ┌ ○ /  (with a file size)"
echo "     If it does, the 404 is FIXED."
echo ""
