"""Update TOC/PAGE/NUMPAGES fields in the DOCX and export a distribution PDF.

Uses LibreOffice headless to (1) open the DOCX, (2) refresh all TOC / field
indexes, (3) export to PDF. This produces a distribution PDF whose Table of
Contents is fully populated with page numbers.

Requires libreoffice / soffice on the PATH.
"""
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import date

DOCX = os.environ.get(
    "DOCX",
    f"/app/frontend/public/downloads/legal-launch-binder-v5-{date.today().isoformat()}.docx",
)
OUT_DIR = os.path.dirname(DOCX)
OUT_PDF = DOCX.replace(".docx", ".pdf")

MACRO = r"""
import uno
from com.sun.star.beans import PropertyValue

def make_prop(name, value):
    p = PropertyValue()
    p.Name = name
    p.Value = value
    return p

def run(src_path, out_path):
    ctx = uno.getComponentContext()
    resolver = ctx.ServiceManager.createInstanceWithContext(
        "com.sun.star.bridge.UnoUrlResolver", ctx)
    smgr_ctx = resolver.resolve(
        "uno:socket,host=127.0.0.1,port=2202;urp;StarOffice.ComponentContext")
    smgr = smgr_ctx.ServiceManager
    desktop = smgr.createInstanceWithContext(
        "com.sun.star.frame.Desktop", smgr_ctx)

    src_url = "file://" + src_path
    out_url = "file://" + out_path

    load_props = (make_prop("Hidden", True), make_prop("ReadOnly", False))
    doc = desktop.loadComponentFromURL(src_url, "_blank", 0, load_props)

    # Update all TOC / index fields
    if hasattr(doc, "refresh"):
        doc.refresh()
    if hasattr(doc, "DocumentIndexes"):
        idxs = doc.DocumentIndexes
        for i in range(idxs.Count):
            idxs.getByIndex(i).update()
    if hasattr(doc, "TextFields"):
        doc.TextFields.refresh()

    # Export to PDF
    pdf_props = (make_prop("FilterName", "writer_pdf_Export"),)
    doc.storeToURL(out_url, pdf_props)
    doc.close(False)
"""


def main() -> int:
    if not os.path.exists(DOCX):
        print(f"ERROR: DOCX not found at {DOCX}")
        return 1

    with tempfile.TemporaryDirectory() as tmp:
        profile = os.path.join(tmp, "profile")
        # Launch headless soffice with UNO socket
        soffice = subprocess.Popen(
            [
                "soffice",
                "--headless",
                "--norestore",
                "--nologo",
                "--nofirststartwizard",
                f"-env:UserInstallation=file://{profile}",
                "--accept=socket,host=127.0.0.1,port=2202;urp;StarOffice.ServiceManager",
            ]
        )
        try:
            # Wait for socket
            import socket
            import time
            for _ in range(40):
                try:
                    s = socket.create_connection(("127.0.0.1", 2202), timeout=1)
                    s.close()
                    break
                except OSError:
                    time.sleep(0.5)
            else:
                print("ERROR: soffice UNO socket never opened")
                return 2

            # Run macro
            macro_file = os.path.join(tmp, "macro.py")
            with open(macro_file, "w") as f:
                f.write(MACRO + f"\nrun({DOCX!r}, {OUT_PDF!r})\n")
            subprocess.check_call(["/usr/bin/python3", macro_file])
        finally:
            soffice.terminate()
            try:
                soffice.wait(timeout=10)
            except subprocess.TimeoutExpired:
                soffice.kill()

    size = os.path.getsize(OUT_PDF)
    print(f"SUCCESS: {OUT_PDF} — {size} bytes ({size/1024:.1f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
