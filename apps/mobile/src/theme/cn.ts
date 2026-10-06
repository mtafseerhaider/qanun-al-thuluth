import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

import { typeScale } from './tokens';

// Our font-size keys (text-body, text-ur-title, ...) must not be mistaken for text colours.
const fontSizeKeys = [
  ...Object.keys(typeScale.latin),
  ...Object.keys(typeScale.latin).map((k) => `ur-${k}`),
];

const twMerge = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: fontSizeKeys }] } },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
