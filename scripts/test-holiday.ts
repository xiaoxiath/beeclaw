#!/usr/bin/env bun
/**
 * Test script for holiday API integration
 */

import { fetchHolidayInfo, formatHolidayDescription, getDateContext } from '../src/utils/holiday';

async function main() {
  console.log('Testing Holiday API Integration\n');
  console.log('='.repeat(50));

  // Test 1: Fetch today's holiday info
  console.log('\n1. Fetching today\'s holiday info...');
  const todayInfo = await fetchHolidayInfo();
  if (todayInfo) {
    console.log('Success!');
    console.log('Date:', todayInfo.date);
    console.log('Is Workday:', todayInfo.isWorkday);
    console.log('Is Holiday:', todayInfo.isHoliday);
    console.log('Is Adjusted:', todayInfo.isAdjusted);
    console.log('Holiday Name:', todayInfo.holidayName || 'N/A');
    console.log('Week Day:', todayInfo.weekDay);
  } else {
    console.log('Failed to fetch holiday info');
  }

  // Test 2: Format holiday description
  console.log('\n2. Formatting holiday description...');
  if (todayInfo) {
    const description = formatHolidayDescription(todayInfo);
    console.log(description);
  }

  // Test 3: Get date context for system prompt
  console.log('\n3. Getting date context...');
  const context = getDateContext();
  console.log(context);

  // Test 4: Fetch a specific date (2026-03-02 should be a regular workday)
  console.log('\n4. Fetching specific date: 2026-03-02...');
  const specificDate = new Date('2026-03-02');
  const specificInfo = await fetchHolidayInfo(specificDate);
  if (specificInfo) {
    console.log(formatHolidayDescription(specificInfo));
  }

  // Test 5: Fetch a holiday (2026-10-01 should be National Day)
  console.log('\n5. Fetching holiday date: 2026-10-01...');
  const holidayDate = new Date('2026-10-01');
  const holidayInfo = await fetchHolidayInfo(holidayDate);
  if (holidayInfo) {
    console.log(formatHolidayDescription(holidayInfo));
  }

  console.log('\n' + '='.repeat(50));
  console.log('✅ All tests completed!');
}

main().catch(console.error);
