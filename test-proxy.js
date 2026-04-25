const fs = require('fs');
const path = require('path');

async function test() {
  const fileBlob = new Blob([Buffer.from('test')], { type: 'audio/mpeg' });
  const formData = new FormData();
  formData.append('file', fileBlob, 'test.m4a');
  console.log('FormData:', formData);
}
test();
