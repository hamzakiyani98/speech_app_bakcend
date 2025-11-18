// Helper function to determine gender from voice name
function getGenderFromVoice(voiceName) {
  console.log('🔍 BACKEND DEBUG - Determining gender for voice:', voiceName);

  // Extract the voice type (last part after last dash)
  const parts = voiceName.split('-');
  const voiceType = parts[parts.length - 1]; // Gets 'A', 'F', 'J', etc.

  console.log('🔍 BACKEND DEBUG - Voice parts:', parts);
  console.log('🔍 BACKEND DEBUG - Voice type extracted:', voiceType);

  // Google Neural2 voice gender mapping
  const maleVoices = ['A', 'D', 'I', 'J'];
  const femaleVoices = ['C', 'F', 'G', 'H'];

  let gender = 'NEUTRAL';

  if (maleVoices.includes(voiceType)) {
    gender = 'MALE';
    console.log('✅ BACKEND DEBUG - Voice identified as MALE:', voiceType);
  } else if (femaleVoices.includes(voiceType)) {
    gender = 'FEMALE';
    console.log('✅ BACKEND DEBUG - Voice identified as FEMALE:', voiceType);
  } else {
    console.warn('⚠️ BACKEND DEBUG - Unknown voice type, defaulting to NEUTRAL:', voiceType);
  }

  return gender;
}

module.exports = {
  getGenderFromVoice
};
