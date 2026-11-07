// Small spelling/spacing corrections only; retain uncertain model numbers.
const corrections = new Map([
  ['Buck convertor (lipos to PIs)', 'Buck converter (lipos to PIs)'],
  ['Grover Stepper Motor', 'Grove Stepper Motor'],
  ['Through Hole Mosfet', 'Through Hole MOSFET'],
  ['Sense CAP Indicator', 'SenseCAP Indicator'],
  ['USB 3.1TYPE male plug breakout', 'USB 3.1 Type male plug breakout'],
  ['Sonar Altimeter and Echosounder', 'Sonar Altimeter and Echosounder (PING)']
]);
function correctedName(name) { return corrections.get(name) || name; }
function protectedFromRemoval(name) {
  return /^DMM$/i.test(name.trim()) || /small solder(?:able|eable) (?:prototyping board|breadboard)/i.test(name) || /sonar altimeter.*echosounder/i.test(name);
}
module.exports = {correctedName, protectedFromRemoval};
