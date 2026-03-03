#!/usr/bin/env bun
/**
 * Quick test for daily weather forecast
 */

import { fetchDailyWeatherInfo, formatDailyWeatherDescription } from '../src/utils/weather';
import { loadConfig } from '../src/config';

async function main() {
  await loadConfig();

  console.log('Testing Daily Weather Forecast\n');

  // Test 3-day forecast
  console.log('1. Testing 3-day forecast for 北京...');
  const forecast3 = await fetchDailyWeatherInfo('北京', '3d');
  if (forecast3) {
    console.log('\n' + formatDailyWeatherDescription(forecast3));
  } else {
    console.log('Failed to fetch 3-day forecast');
  }

  console.log('\n' + '='.repeat(60) + '\n');

  // Test 7-day forecast
  console.log('2. Testing 7-day forecast for 上海...');
  const forecast7 = await fetchDailyWeatherInfo('上海', '7d');
  if (forecast7) {
    console.log('\n' + formatDailyWeatherDescription(forecast7));
  } else {
    console.log('Failed to fetch 7-day forecast');
  }
}

main().catch(console.error);
