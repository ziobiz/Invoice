#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get install -y fonts-noto-cjk fonts-noto-core fonts-tlwg-garuda || true
echo "FONTS_OK"
