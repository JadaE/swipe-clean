import { requireOptionalNativeModule } from 'expo-modules-core';
// null in unit tests / non-Android
export default requireOptionalNativeModule<any>('SwipeCleanMedia');
