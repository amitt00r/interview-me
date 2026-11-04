#!/usr/bin/env python3
"""
Imports the official AWS and Azure architecture icon packages into the whiteboard's component panel.

Download and unzip them first (both permit use in architecture diagrams; see public/whiteboard-icons/README.md):
  AWS:   https://aws.amazon.com/architecture/icons/  ("Icon package" zip)
  Azure: https://learn.microsoft.com/azure/architecture/icons/  (Azure_Public_Service_Icons_V*.zip)

  python3 -I scripts/import-cloud-icons.py <unzipped AWS dir> <unzipped Azure dir>

Copies one SVG per icon to public/whiteboard-icons/{aws,azure}/ (replacing what is there) and writes
public/whiteboard-icons/index.json: [{provider, category, name, file}], grouped by the packages' own categories,
which the component panel loads at runtime. Both are git-ignored: the icons' licences allow diagrams, not
redistribution, so everyone imports their own copy.
"""
import json
import re
import shutil
import sys
from pathlib import Path

FRONTEND = Path(__file__).resolve().parent.parent
OUT = FRONTEND / 'public' / 'whiteboard-icons'
MANIFEST = OUT / 'index.json'

# The packages' folder names, made readable where hyphens or lower case lose meaning.
AWS_CATEGORIES = {
    'Networking-Content-Delivery': 'Networking & Content Delivery',
    'Security-Identity': 'Security, Identity & Compliance',
    'Migration-Modernization': 'Migration & Modernization',
    'Front-End-Web-Mobile': 'Front-End Web & Mobile',
    'Management-Tools': 'Management & Governance',
    'Internet-of-Things': 'Internet of Things',
    # Resource icon folders spell some categories differently.
    'IoT': 'Internet of Things',
    'Management-Governance': 'Management & Governance',
}
AZURE_CATEGORIES = {'devops': 'DevOps', 'iot': 'IoT', 'menu': 'General', 'new icons': 'New'}
SMALL_WORDS = {'and', 'of', 'for', 'to', 'on', 'in', 'the'}
UPPER = {'ai'}


def title(s: str) -> str:
    words = s.split()
    return ' '.join(w.upper() if w.lower() in UPPER else w if (i and w in SMALL_WORDS) else w[:1].upper() + w[1:]
                    for i, w in enumerate(words))


def slug(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


def first(root: Path, pattern: str) -> Path:
    found = sorted(root.glob(pattern))
    if not found:
        sys.exit(f'Nothing matches {pattern} under {root}: is this the unzipped package?')
    return found[0]


def aws(root: Path, icons: list):
    services = first(root, 'Architecture-Service-Icons_*')
    for svg in sorted(services.glob('Arch_*/48/*.svg')):
        category = svg.parent.parent.name.removeprefix('Arch_')
        name = re.sub(r'_48$', '', svg.stem.removeprefix('Arch_')).replace('-', ' ')
        icons.append(('AWS', AWS_CATEGORIES.get(category, category.replace('-', ' ')), name, svg))
    resources = first(root, 'Resource-Icons_*')
    for svg in sorted(resources.glob('Res_*/*.svg')):
        if 'Dark' in svg.stem:
            continue
        category = svg.parent.name.removeprefix('Res_')
        # Res_Amazon-EC2_Elastic-IP-Address_48 → "Amazon EC2 Elastic IP Address"
        name = re.sub(r'_(48|Light)$', '', re.sub(r'_48(_Light)?$', '', svg.stem.removeprefix('Res_')))
        name = re.sub(r'\s+', ' ', name.replace('_', ' ').replace('-', ' ')).strip()
        # Filed under the service's own category, after the service icons.
        icons.append(('AWS', AWS_CATEGORIES.get(category, category.replace('-', ' ')), name, svg))
    groups = first(root, 'Architecture-Group-Icons_*')
    for svg in sorted(groups.glob('*_32.svg')):
        icons.append(('AWS', 'Groups', svg.stem.removesuffix('_32').replace('-', ' '), svg))


def azure(root: Path, icons: list):
    base = first(root, '**/Icons')
    seen = set()
    for svg in sorted(base.glob('*/*.svg')):
        # 00195-icon-service-Maintenance-Configuration → "Maintenance Configuration"
        name = re.sub(r'^\d+-icon-service-', '', svg.stem).replace('-', ' ').strip()
        if name.lower() in seen:  # Some icons are filed under several categories: keep the first.
            continue
        seen.add(name.lower())
        folder = svg.parent.name
        icons.append(('Azure', AZURE_CATEGORIES.get(folder, title(folder)), name, svg))


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    icons: list = []
    aws(Path(sys.argv[1]), icons)
    azure(Path(sys.argv[2]), icons)

    for provider in ('aws', 'azure'):
        shutil.rmtree(OUT / provider, ignore_errors=True)
    manifest, used = [], set()
    # Grouped by category, in each provider's first-seen order (AWS service icons before resources).
    order = {}
    for provider, category, _, _ in icons:
        order.setdefault((provider, category), len(order))
    icons.sort(key=lambda i: order[(i[0], i[1])])
    for provider, category, name, svg in icons:
        file = f'{provider.lower()}/{slug(category)}/{slug(name)}.svg'
        if file in used:
            continue
        used.add(file)
        (OUT / file).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(svg, OUT / file)
        manifest.append({'provider': provider, 'category': category, 'name': name, 'file': file})
    MANIFEST.write_text(json.dumps(manifest, indent=0, ensure_ascii=False) + '\n')
    for provider in ('AWS', 'Azure'):
        mine = [m for m in manifest if m['provider'] == provider]
        print(f'{provider}: {len(mine)} icons in {len({m["category"] for m in mine})} categories')


if __name__ == '__main__':
    main()
