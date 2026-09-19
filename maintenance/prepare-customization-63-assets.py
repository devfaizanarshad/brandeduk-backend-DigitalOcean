import json
import os
from pathlib import Path

from PIL import Image


PACKAGE_ROOT = Path(
    os.environ.get(
        "CUSTOMIZATION_63_PACKAGE_ROOT",
        Path(__file__).resolve().parents[2]
        / "BrandedUK_All_63_Categories"
        / "BrandedUK_Logo_Positions",
    )
)
OUTPUT_ROOT = Path(
    os.environ.get("CUSTOMIZATION_63_ASSET_ROOT", PACKAGE_ROOT / "optimized-webp")
)
MAX_BYTES = 900 * 1024


def main():
    inventory = json.loads((PACKAGE_ROOT / "inventory.json").read_text(encoding="utf-8"))
    output_sizes = []

    for item in inventory:
        source = PACKAGE_ROOT / item["file"]
        target = OUTPUT_ROOT / Path(item["file"]).with_suffix(".webp")
        target.parent.mkdir(parents=True, exist_ok=True)

        if target.exists() and target.stat().st_size <= MAX_BYTES:
            output_sizes.append(target.stat().st_size)
            continue

        with Image.open(source) as image:
            image.save(target, "WEBP", quality=90, method=4)

        size = target.stat().st_size
        if size > MAX_BYTES:
            with Image.open(source) as image:
                image.save(target, "WEBP", quality=82, method=4)
            size = target.stat().st_size
        if size > MAX_BYTES:
            raise RuntimeError(f"Optimized asset remains too large: {target} ({size} bytes)")
        output_sizes.append(size)

    print(
        f"PREPARED assets={len(output_sizes)} "
        f"bytes={sum(output_sizes)} maxBytes={max(output_sizes)} output={OUTPUT_ROOT}"
    )


if __name__ == "__main__":
    main()
