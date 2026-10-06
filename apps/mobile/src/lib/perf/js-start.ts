// Imported first by index.ts so `js_start` is taken before any other app module is evaluated.
import { markStartup } from './startup';

markStartup('js_start');
