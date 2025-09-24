#!/bin/bash

# Run the SRG2 connectivity fix tests
echo "🧪 Running SRG2 connectivity fix validation tests..."

# Run specific test file
npm test src/utils/__tests__/srg2ConnectivityFix.test.ts

echo "✅ Test execution completed"