from pathlib import Path
import json
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
extension = root / 'extension'
version = json.loads((extension / 'manifest.json').read_text())['version']
destination = root / 'dist' / f'loghmeh-{version}.zip'
destination.parent.mkdir(exist_ok=True)
with ZipFile(destination, 'w', ZIP_DEFLATED) as archive:
    for source in sorted(extension.rglob('*')):
        if source.is_file():
            archive.write(source, source.relative_to(extension))
    archive.write(root / 'LICENSE', 'LICENSE')
print(destination)
