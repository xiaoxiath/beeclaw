#!/usr/bin/env bun
/**
 * Test script for QWeather API integration
 */

import { fetchWeatherInfo, formatWeatherDescription, getWeatherContext, clearWeatherCache } from '../src/utils/weather';

async function main() {
  console.log('Testing QWeather API Integration\n');
  console.log('='.repeat(50));

  // Check configuration
  console.log('\n0. Checking configuration...');
  console.log('   QWEATHER_APIHOST:', process.env.QWEATHER_APIHOST || '(not set, will use default)');
  console.log('   QWEATHER_TOKEN:', process.env.QWEATHER_TOKEN ? '(configured)' : '(not set)');
  console.log('   QWEATHER_LOCATION:', process.env.QWEATHER_LOCATION || '(not set, will use default: 北京)');

  if (!process.env.QWEATHER_TOKEN) {
    console.log('\n❌ QWEATHER_TOKEN not configured. Please set it in .env file.');
    console.log('   Get your token from: https://dev.qweather.com/\n');
    return;
  }

  // Test 1: Fetch weather info
  console.log('\n1. Fetching weather info...');
  const weatherInfo = await fetchWeatherInfo();
  if (weatherInfo) {
    console.log('Success!');
    console.log('Location:', weatherInfo.location);
    console.log('Location ID:', weatherInfo.locationId);
    console.log('Temperature:', weatherInfo.temp + '°C');
    console.log('Weather:', weatherInfo.text);
    console.log('Wind:', weatherInfo.windDir, weatherInfo.windScale);
    console.log('Humidity:', weatherInfo.humidity + '%');
    console.log('Update Time:', weatherInfo.updateTime);
  } else {
    console.log('Failed to fetch weather info');
  }

  // Test 2: Format weather description
  console.log('\n2. Formatting weather description...');
  if (weatherInfo) {
    const description = formatWeatherDescription(weatherInfo);
    console.log(description);
  }

  // Test 3: Get weather context for system prompt
  console.log('\n3. Getting weather context...');
  const context = getWeatherContext();
  if (context) {
    console.log(context);
  } else {
    console.log('Weather context not available (cache not populated)');
  }

  // Test 4: Test caching
  console.log('\n4. Testing cache...');
  const start = Date.now();
  const cachedInfo = await fetchWeatherInfo();
  const duration = Date.now() - start;
  if (cachedInfo && duration < 10) {
    console.log(`✓ Cache working (fetch took ${duration}ms)`);
  } else {
    console.log(`⚠ Cache may not be working (fetch took ${duration}ms)`);
  }

  // Test 5: Fetch weather for a specific location
  console.log('\n5. Fetching weather for Shanghai...');
  clearWeatherCache();
  const shanghaiWeather = await fetchWeatherInfo('上海');
  if (shanghaiWeather) {
    console.log(formatWeatherDescription(shanghaiWeather));
  }

  // Test 6: Clear cache
  console.log('\n6. Testing cache clear...');
  clearWeatherCache();
  const afterClear = getWeatherContext();
  if (!afterClear) {
    console.log('✓ Cache cleared successfully');
  } else {
    console.log('⚠ Cache clear may not have worked');
  }

  console.log('\n' + '='.repeat(50));
  console.log('✅ All tests completed!');
}

main().catch(console.error);
