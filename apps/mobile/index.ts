// First import: the cold-start clock (24 S7-01, docs/perf-s7.md).
import './src/lib/perf/js-start';
import './global.css';

import { registerRootComponent } from 'expo';

import App from './src/app/App';

registerRootComponent(App);
