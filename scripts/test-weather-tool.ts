#!/usr/bin/env bun
/**
 * Test script for weather tool using QWeather API
 */

import { executeWeather } from '../src/tools/builtin';
import { loadConfig } from '../src/config';

async function main() {
  // Load configuration first
  await loadConfig();

  console.log('Testing Weather Tool with QWeather API\n');
  console.log('='.repeat(60));

  // Test 1: Current weather for Beijing
  console.log('\n📍 Test 1: Current weather for 北京 (Beijing)');
  const result1 = await executeWeather({ location: '北京', format: 'current' });
  console.log('Success:', result1.success);
  if (result1.success) {
            console.log('Data:\n', result1.data);
        } else {
            console.log('Error:', result1.error);
        }

  // Test 2: Detailed weather for Shanghai
  console.log('\n📍 Test 2: Detailed weather for 上海 (Shanghai)');
  const result2 = await executeWeather({ location: '上海', format: 'detailed' });
  console.log('Success:', result2.success);
  if (result2.success) {
            console.log('Data:\n', result2.data);
        } else {
            console.log('Error:', result2.error);
        }

  // Test 3: 3-day forecast for 深圳
  console.log('\n📍 Test 3: 3-day forecast for 深圳 (Shenzhen)');
  const result3 = await executeWeather({ location: '深圳', format: 'forecast', days: '3d' });
  console.log('Success:', result3.success);
  if (result3.success) {
            console.log('Data:\n', result3.data);
        } else {
            console.log('Error:', result3.error);
        }

  // Test 4: 7-day forecast for 广州
  console.log('\n📍 Test 4: 7-day forecast for 广州 (Guangzhou)');
  const result4 = await executeWeather({ location: '广州', format: 'forecast', days: '7d' });
  console.log('Success:', result4.success);
  if (result4.success) {
            console.log('Data:\n', result4.data);
        } else {
            console.log('Error:', result4.error);
        }

  // Test 5: Invalid location
  console.log('\n📍 Test 5: Invalid location (should handle gracefully)');
  const result5 = await executeWeather({ location: '不存在的城市123', format: 'current' });
  console.log('Success:', result5.success);
          if (result5.success) {
            console.log('Data:', result5.data);
        } else {
            console.log('Error:', result5.error);
        }

      // Test 6: Missing parameters
      console.log('\n📍 Test 6: Missing parameters (should fail validation)');
      const result6 = await executeWeather({});
      console.log('Success:', result6.success);
      if (result6.success) {
            console.log('Data:', result6.data);
        } else {
            console.log('Error:', result6.error);
        }

      console.log('\n' + '='.repeat(60));
      console.log('✅ All tests completed!\n');

      if (!process.env.QWEATHER_KEY && !process.env.QWEATHER_TOKEN) {
        console.log('⚠️  Note: QWEATHER_KEY or QWEATHER_TOKEN not configured.');
        console.log('   Weather tool will return error messages asking to configure API keys.');
        console.log('   To test with real data, please configure:');
        console.log('   - QWEATHER_KEY (recommended, simpler)');
        console.log('   - or QWEATHER_TOKEN (JWT token)');
        console.log('   Get your credentials from: https://dev.qweather.com/\n');
      }
}

main().catch(console.error);
