/**
 * Optional jobs taken from the original Microboards software (test disc, clean verification
 * disc, pen-alignment patterns). They are HP/Microboards data, so they are not part of the
 * source tree: tools/extract_vendor.py pulls them out of the official PF-3 installer.
 */
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export type VendorJob = 'test-disc' | 'clean-verify' | 'align-vertical' | 'align-pattern2';
const FILES: Record<VendorJob, string> = {
  'test-disc': 'pf3_test_print.pcl',
  'clean-verify': 'pf3_clean_pen.pcl',
  'align-vertical': 'si500_vertical_alignment.pcl',
  'align-pattern2': 'si500_alignment_pattern2.pcl',
};

export function vendorDirs(): string[] {
  return [
    path.join(app.getPath('userData'), 'vendor'),
    path.join(process.resourcesPath ?? '', 'vendor'),
    path.join(__dirname, '..', 'vendor'),
  ];
}

export function loadVendorJob(which: VendorJob): Buffer | null {
  for (const d of vendorDirs()) {
    const p = path.join(d, FILES[which]);
    if (fs.existsSync(p)) return fs.readFileSync(p);
  }
  return null;
}

export function vendorAvailability(): Record<VendorJob, boolean> {
  const r = {} as Record<VendorJob, boolean>;
  for (const k of Object.keys(FILES) as VendorJob[]) r[k] = loadVendorJob(k) !== null;
  return r;
}
