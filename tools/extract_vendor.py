"""
Extract the pre-rendered maintenance jobs (test disc, cleaning-verification disc and the two
pen-alignment patterns) from the original Microboards Toolbox.exe into PF3 Studio's vendor folder.

    pip install pefile
    python extract_vendor.py "C:\\path\\to\\Toolbox.exe" [output_dir]

Toolbox.exe ships inside Microboards' PF-3_Installer.exe (InstallShield). These files are
HP/Microboards data and are deliberately not part of this repository.
"""
import os, sys
import pefile

WANTED = {143: 'pf3_clean_pen.pcl', 144: 'pf3_test_print.pcl', 147: 'si500_vertical_alignment.pcl', 148: 'si500_alignment_pattern2.pcl'}

def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.environ.get('APPDATA', '.'), 'PF3 Studio', 'vendor')
    os.makedirs(out, exist_ok=True)
    pe = pefile.PE(sys.argv[1])
    found = 0
    for t in pe.DIRECTORY_ENTRY_RESOURCE.entries:
        if str(t.name) != 'BINARY':
            continue
        for e in t.directory.entries:
            if e.struct.Id in WANTED:
                lang = e.directory.entries[0]
                data = pe.get_data(lang.data.struct.OffsetToData, lang.data.struct.Size)
                with open(os.path.join(out, WANTED[e.struct.Id]), 'wb') as f:
                    f.write(data)
                print('wrote', WANTED[e.struct.Id], len(data), 'bytes'); found += 1
    print(f'{found}/4 files written to {out}')

if __name__ == '__main__':
    main()
