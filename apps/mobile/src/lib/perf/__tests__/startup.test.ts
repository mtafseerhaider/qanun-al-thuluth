import {
  getStartupReport,
  markStartup,
  onStartupReport,
  resetStartupForTests,
  whenIdle,
} from '../startup';

describe('startup timing (24 S7-01)', () => {
  let now = 0;
  beforeEach(() => {
    now = 0;
    resetStartupForTests(() => now);
  });

  it('reports each mark relative to js_start, once', () => {
    const reporter = jest.fn();
    onStartupReport(reporter);
    now = 100;
    markStartup('js_start');
    now = 250;
    markStartup('bootstrap_done');
    now = 900;
    markStartup('nav_ready');
    now = 1000;
    markStartup('nav_ready'); // ignored: first value wins
    now = 1400;
    markStartup('today_interactive');
    markStartup('today_interactive');
    expect(reporter).toHaveBeenCalledTimes(1);
    expect(reporter.mock.calls[0][0].sinceJsStart).toEqual({
      js_start: 0,
      bootstrap_done: 150,
      nav_ready: 800,
      today_interactive: 1300,
    });
  });

  it('returns no durations before js_start', () => {
    markStartup('nav_ready');
    expect(getStartupReport().sinceJsStart).toEqual({});
  });

  it('never lets a failing reporter break startup', () => {
    onStartupReport(() => {
      throw new Error('boom');
    });
    markStartup('js_start');
    expect(() => markStartup('today_interactive')).not.toThrow();
  });

  it('runs deferred work even without requestIdleCallback', () => {
    jest.useFakeTimers();
    const task = jest.fn();
    whenIdle(task);
    jest.runAllTimers();
    expect(task).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
