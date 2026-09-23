#!/bin/bash
# Install/extract single-file CJK fonts for PDFKit (TTC is unreliable).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get install -y fonts-noto-cjk fonts-noto-core fonts-tlwg-garuda python3-pip || true

FONT_DIR="/opt/invoice-service/fonts"
mkdir -p "$FONT_DIR"

need_extract=0
for f in NotoSansKR-Regular.otf NotoSansJP-Regular.otf NotoSansSC-Regular.otf; do
  if [ ! -f "$FONT_DIR/$f" ]; then need_extract=1; fi
done

if [ "$need_extract" = "1" ]; then
  pip3 install --quiet 'fonttools>=4.39' || true
  python3 - <<'PY'
from pathlib import Path
try:
    from fontTools.ttLib import TTCollection
except ImportError:
    raise SystemExit("fonttools missing")

ttc_path = Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc")
out_dir = Path("/opt/invoice-service/fonts")
out_dir.mkdir(parents=True, exist_ok=True)
if not ttc_path.is_file():
    raise SystemExit(f"missing {ttc_path}")

ttc = TTCollection(str(ttc_path))
# Noto Sans CJK OTC order: JP, KR, SC, TC, HK
targets = {
    0: "NotoSansJP-Regular.otf",
    1: "NotoSansKR-Regular.otf",
    2: "NotoSansSC-Regular.otf",
}
for idx, name in targets.items():
    dest = out_dir / name
    if dest.is_file() and dest.stat().st_size > 1000:
        print("skip", dest)
        continue
    if idx >= len(ttc.fonts):
        print("missing face", idx)
        continue
    ttc.fonts[idx].save(str(dest))
    print("wrote", dest, dest.stat().st_size)
PY
fi

ls -la "$FONT_DIR" || true
echo "FONTS_OK"
