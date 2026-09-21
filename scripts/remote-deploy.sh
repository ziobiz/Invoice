#!/bin/bash
set -euo pipefail
mkdir -p /opt/invoice-service
cd /opt/invoice-service
tar -xzf /tmp/invoice-service-deploy.tgz
sed -i 's/\r$//' scripts/*.sh || true
chmod +x scripts/*.sh
bash scripts/deploy.sh
