// Lingora Mic: a virtual audio device for calls.
//
// An AudioServerPlugIn (loaded by coreaudiod, not a kernel extension) that
// publishes one device, "Lingora Mic", with an output stream and an input
// stream joined by a ring buffer. Lingora plays the translated voice into the
// output; Meet, Zoom or any other app picks the device as its microphone and
// reads it from the input.
//
// Written from scratch on the public AudioServerPlugIn.h API. Fixed format:
// 48 kHz, stereo, 32-bit float. No volume controls.

#include <CoreAudio/AudioServerPlugIn.h>
#include <mach/mach_time.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stddef.h>
#include <string.h>

#define kDeviceName "Lingora Mic"
#define kDeviceUID "LingoraMic_UID"
#define kModelUID "LingoraMic_ModelUID"
#define kManufacturer "Lingora"

enum {
  kObjectID_PlugIn = kAudioObjectPlugInObject,
  kObjectID_Device = 2,
  kObjectID_StreamInput = 3,
  kObjectID_StreamOutput = 4,
};

static const Float64 kSampleRate = 48000.0;
static const UInt32 kChannels = 2;
/// Ring length in frames (~0.34 s). It is also the zero time stamp period.
#define kRingFrames 16384

// MARK: - State

static AudioServerPlugInHostRef gHost = NULL;
static _Atomic UInt32 gRefCount = 0;
static pthread_mutex_t gMutex = PTHREAD_MUTEX_INITIALIZER;

static UInt32 gIOCount = 0;
static UInt32 gInputActive = 1;
static UInt32 gOutputActive = 1;

static Float64 gHostTicksPerFrame = 0;
static UInt64 gAnchorHostTime = 0;
static UInt64 gNumberTimeStamps = 0;

/// Interleaved samples, indexed by sample time modulo the ring length.
static Float32 gRing[kRingFrames * 2];
/// Frames in [gWriteStart, gWriteEnd) hold voice that was written and not yet
/// overwritten. Everything else reads as silence, so when Lingora stops
/// playing the call hears nothing instead of the last ring looping.
static SInt64 gWriteStart = 0;
static SInt64 gWriteEnd = 0;

// MARK: - Interface (forward declarations)

static HRESULT Lingora_QueryInterface(void* inDriver, REFIID inUUID, LPVOID* outInterface);
static ULONG Lingora_AddRef(void* inDriver);
static ULONG Lingora_Release(void* inDriver);
static OSStatus Lingora_Initialize(AudioServerPlugInDriverRef inDriver, AudioServerPlugInHostRef inHost);
static OSStatus Lingora_CreateDevice(AudioServerPlugInDriverRef inDriver, CFDictionaryRef inDescription,
                                     const AudioServerPlugInClientInfo* inClientInfo, AudioObjectID* outDeviceObjectID);
static OSStatus Lingora_DestroyDevice(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID);
static OSStatus Lingora_AddDeviceClient(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID,
                                        const AudioServerPlugInClientInfo* inClientInfo);
static OSStatus Lingora_RemoveDeviceClient(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID,
                                           const AudioServerPlugInClientInfo* inClientInfo);
static OSStatus Lingora_PerformDeviceConfigurationChange(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID,
                                                         UInt64 inChangeAction, void* inChangeInfo);
static OSStatus Lingora_AbortDeviceConfigurationChange(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID,
                                                       UInt64 inChangeAction, void* inChangeInfo);
static Boolean Lingora_HasProperty(AudioServerPlugInDriverRef inDriver, AudioObjectID inObjectID, pid_t inClientProcessID,
                                   const AudioObjectPropertyAddress* inAddress);
static OSStatus Lingora_IsPropertySettable(AudioServerPlugInDriverRef inDriver, AudioObjectID inObjectID,
                                           pid_t inClientProcessID, const AudioObjectPropertyAddress* inAddress,
                                           Boolean* outIsSettable);
static OSStatus Lingora_GetPropertyDataSize(AudioServerPlugInDriverRef inDriver, AudioObjectID inObjectID,
                                            pid_t inClientProcessID, const AudioObjectPropertyAddress* inAddress,
                                            UInt32 inQualifierDataSize, const void* inQualifierData, UInt32* outDataSize);
static OSStatus Lingora_GetPropertyData(AudioServerPlugInDriverRef inDriver, AudioObjectID inObjectID, pid_t inClientProcessID,
                                        const AudioObjectPropertyAddress* inAddress, UInt32 inQualifierDataSize,
                                        const void* inQualifierData, UInt32 inDataSize, UInt32* outDataSize, void* outData);
static OSStatus Lingora_SetPropertyData(AudioServerPlugInDriverRef inDriver, AudioObjectID inObjectID, pid_t inClientProcessID,
                                        const AudioObjectPropertyAddress* inAddress, UInt32 inQualifierDataSize,
                                        const void* inQualifierData, UInt32 inDataSize, const void* inData);
static OSStatus Lingora_StartIO(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID, UInt32 inClientID);
static OSStatus Lingora_StopIO(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID, UInt32 inClientID);
static OSStatus Lingora_GetZeroTimeStamp(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID, UInt32 inClientID,
                                         Float64* outSampleTime, UInt64* outHostTime, UInt64* outSeed);
static OSStatus Lingora_WillDoIOOperation(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID, UInt32 inClientID,
                                          UInt32 inOperationID, Boolean* outWillDo, Boolean* outWillDoInPlace);
static OSStatus Lingora_BeginIOOperation(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID, UInt32 inClientID,
                                         UInt32 inOperationID, UInt32 inIOBufferFrameSize,
                                         const AudioServerPlugInIOCycleInfo* inIOCycleInfo);
static OSStatus Lingora_DoIOOperation(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID, AudioObjectID inStreamObjectID,
                                      UInt32 inClientID, UInt32 inOperationID, UInt32 inIOBufferFrameSize,
                                      const AudioServerPlugInIOCycleInfo* inIOCycleInfo, void* ioMainBuffer,
                                      void* ioSecondaryBuffer);
static OSStatus Lingora_EndIOOperation(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID, UInt32 inClientID,
                                       UInt32 inOperationID, UInt32 inIOBufferFrameSize,
                                       const AudioServerPlugInIOCycleInfo* inIOCycleInfo);

static AudioServerPlugInDriverInterface gInterface = {
    NULL,
    Lingora_QueryInterface,
    Lingora_AddRef,
    Lingora_Release,
    Lingora_Initialize,
    Lingora_CreateDevice,
    Lingora_DestroyDevice,
    Lingora_AddDeviceClient,
    Lingora_RemoveDeviceClient,
    Lingora_PerformDeviceConfigurationChange,
    Lingora_AbortDeviceConfigurationChange,
    Lingora_HasProperty,
    Lingora_IsPropertySettable,
    Lingora_GetPropertyDataSize,
    Lingora_GetPropertyData,
    Lingora_SetPropertyData,
    Lingora_StartIO,
    Lingora_StopIO,
    Lingora_GetZeroTimeStamp,
    Lingora_WillDoIOOperation,
    Lingora_BeginIOOperation,
    Lingora_DoIOOperation,
    Lingora_EndIOOperation,
};
static AudioServerPlugInDriverInterface* gInterfacePtr = &gInterface;
static AudioServerPlugInDriverRef gDriverRef = &gInterfacePtr;

// MARK: - Factory and IUnknown

/// Entry point named in Info.plist (CFPlugInFactories).
void* LingoraMic_Create(CFAllocatorRef inAllocator, CFUUIDRef inRequestedTypeUUID) {
  (void)inAllocator;
  if (CFEqual(inRequestedTypeUUID, kAudioServerPlugInTypeUUID)) return gDriverRef;
  return NULL;
}

static HRESULT Lingora_QueryInterface(void* inDriver, REFIID inUUID, LPVOID* outInterface) {
  if (inDriver != gDriverRef || outInterface == NULL) return kAudioHardwareBadObjectError;
  CFUUIDRef requested = CFUUIDCreateFromUUIDBytes(NULL, inUUID);
  if (requested == NULL) return kAudioHardwareIllegalOperationError;
  HRESULT result = E_NOINTERFACE;
  if (CFEqual(requested, IUnknownUUID) || CFEqual(requested, kAudioServerPlugInDriverInterfaceUUID)) {
    atomic_fetch_add(&gRefCount, 1);
    *outInterface = gDriverRef;
    result = S_OK;
  }
  CFRelease(requested);
  return result;
}

static ULONG Lingora_AddRef(void* inDriver) {
  if (inDriver != gDriverRef) return 0;
  return atomic_fetch_add(&gRefCount, 1) + 1;
}

static ULONG Lingora_Release(void* inDriver) {
  if (inDriver != gDriverRef) return 0;
  UInt32 count = atomic_load(&gRefCount);
  while (count > 0 && !atomic_compare_exchange_weak(&gRefCount, &count, count - 1)) {
  }
  return count > 0 ? count - 1 : 0;
}

// MARK: - Basic operations

static OSStatus Lingora_Initialize(AudioServerPlugInDriverRef inDriver, AudioServerPlugInHostRef inHost) {
  if (inDriver != gDriverRef) return kAudioHardwareBadObjectError;
  gHost = inHost;
  mach_timebase_info_data_t timebase;
  mach_timebase_info(&timebase);
  Float64 hostClockFrequency = (Float64)timebase.denom / (Float64)timebase.numer * 1000000000.0;
  gHostTicksPerFrame = hostClockFrequency / kSampleRate;
  return kAudioHardwareNoError;
}

static OSStatus Lingora_CreateDevice(AudioServerPlugInDriverRef inDriver, CFDictionaryRef inDescription,
                                     const AudioServerPlugInClientInfo* inClientInfo, AudioObjectID* outDeviceObjectID) {
  (void)inDriver, (void)inDescription, (void)inClientInfo, (void)outDeviceObjectID;
  return kAudioHardwareUnsupportedOperationError;
}

static OSStatus Lingora_DestroyDevice(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID) {
  (void)inDriver, (void)inDeviceObjectID;
  return kAudioHardwareUnsupportedOperationError;
}

static OSStatus Lingora_AddDeviceClient(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID,
                                        const AudioServerPlugInClientInfo* inClientInfo) {
  (void)inClientInfo;
  if (inDriver != gDriverRef || inDeviceObjectID != kObjectID_Device) return kAudioHardwareBadObjectError;
  return kAudioHardwareNoError;
}

static OSStatus Lingora_RemoveDeviceClient(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID,
                                           const AudioServerPlugInClientInfo* inClientInfo) {
  (void)inClientInfo;
  if (inDriver != gDriverRef || inDeviceObjectID != kObjectID_Device) return kAudioHardwareBadObjectError;
  return kAudioHardwareNoError;
}

static OSStatus Lingora_PerformDeviceConfigurationChange(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID,
                                                         UInt64 inChangeAction, void* inChangeInfo) {
  (void)inChangeAction, (void)inChangeInfo;
  if (inDriver != gDriverRef || inDeviceObjectID != kObjectID_Device) return kAudioHardwareBadObjectError;
  return kAudioHardwareNoError;
}

static OSStatus Lingora_AbortDeviceConfigurationChange(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID,
                                                       UInt64 inChangeAction, void* inChangeInfo) {
  (void)inChangeAction, (void)inChangeInfo;
  if (inDriver != gDriverRef || inDeviceObjectID != kObjectID_Device) return kAudioHardwareBadObjectError;
  return kAudioHardwareNoError;
}

// MARK: - Properties

static AudioStreamBasicDescription StreamFormat(void) {
  AudioStreamBasicDescription f;
  memset(&f, 0, sizeof(f));
  f.mSampleRate = kSampleRate;
  f.mFormatID = kAudioFormatLinearPCM;
  f.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagsNativeEndian | kAudioFormatFlagIsPacked;
  f.mBytesPerPacket = kChannels * sizeof(Float32);
  f.mFramesPerPacket = 1;
  f.mBytesPerFrame = kChannels * sizeof(Float32);
  f.mChannelsPerFrame = kChannels;
  f.mBitsPerChannel = 32;
  return f;
}

/// Writes a fixed-size value, or only reports its size when `out` is NULL.
#define SCALAR(type, value)                                                    \
  do {                                                                         \
    if (out != NULL) {                                                         \
      if (inDataSize < sizeof(type)) return kAudioHardwareBadPropertySizeError; \
      *(type*)out = (value);                                                   \
    }                                                                          \
    *outDataSize = sizeof(type);                                               \
    return kAudioHardwareNoError;                                              \
  } while (0)

/// Copies as many object IDs as fit, or reports the full size when `out` is NULL.
static OSStatus ObjectList(const AudioObjectID* ids, UInt32 count, UInt32 inDataSize, UInt32* outDataSize, void* out) {
  if (out == NULL) {
    *outDataSize = count * sizeof(AudioObjectID);
    return kAudioHardwareNoError;
  }
  UInt32 fit = inDataSize / sizeof(AudioObjectID);
  if (fit > count) fit = count;
  memcpy(out, ids, fit * sizeof(AudioObjectID));
  *outDataSize = fit * sizeof(AudioObjectID);
  return kAudioHardwareNoError;
}

static OSStatus PlugInProperty(const AudioObjectPropertyAddress* a, UInt32 qsz, const void* q, UInt32 inDataSize,
                               UInt32* outDataSize, void* out) {
  static const AudioObjectID devices[] = {kObjectID_Device};
  switch (a->mSelector) {
    case kAudioObjectPropertyBaseClass: SCALAR(AudioClassID, kAudioObjectClassID);
    case kAudioObjectPropertyClass: SCALAR(AudioClassID, kAudioPlugInClassID);
    case kAudioObjectPropertyOwner: SCALAR(AudioObjectID, kAudioObjectUnknown);
    case kAudioObjectPropertyManufacturer: SCALAR(CFStringRef, CFSTR(kManufacturer));
    case kAudioObjectPropertyOwnedObjects:
    case kAudioPlugInPropertyDeviceList: return ObjectList(devices, 1, inDataSize, outDataSize, out);
    case kAudioPlugInPropertyTranslateUIDToDevice: {
      AudioObjectID found = kAudioObjectUnknown;
      if (out != NULL) {
        if (qsz != sizeof(CFStringRef) || q == NULL) return kAudioHardwareBadPropertySizeError;
        CFStringRef uid = *(const CFStringRef*)q;
        if (uid != NULL && CFStringCompare(uid, CFSTR(kDeviceUID), 0) == kCFCompareEqualTo) found = kObjectID_Device;
      }
      SCALAR(AudioObjectID, found);
    }
    case kAudioPlugInPropertyResourceBundle: SCALAR(CFStringRef, CFSTR(""));
    default: return kAudioHardwareUnknownPropertyError;
  }
}

static OSStatus DeviceProperty(const AudioObjectPropertyAddress* a, UInt32 inDataSize, UInt32* outDataSize, void* out) {
  static const AudioObjectID both[] = {kObjectID_StreamInput, kObjectID_StreamOutput};
  static const AudioObjectID input[] = {kObjectID_StreamInput};
  static const AudioObjectID output[] = {kObjectID_StreamOutput};
  switch (a->mSelector) {
    case kAudioObjectPropertyBaseClass: SCALAR(AudioClassID, kAudioObjectClassID);
    case kAudioObjectPropertyClass: SCALAR(AudioClassID, kAudioDeviceClassID);
    case kAudioObjectPropertyOwner: SCALAR(AudioObjectID, kObjectID_PlugIn);
    case kAudioObjectPropertyName: SCALAR(CFStringRef, CFSTR(kDeviceName));
    case kAudioObjectPropertyManufacturer: SCALAR(CFStringRef, CFSTR(kManufacturer));
    case kAudioDevicePropertyDeviceUID: SCALAR(CFStringRef, CFSTR(kDeviceUID));
    case kAudioDevicePropertyModelUID: SCALAR(CFStringRef, CFSTR(kModelUID));
    case kAudioDevicePropertyTransportType: SCALAR(UInt32, kAudioDeviceTransportTypeVirtual);
    case kAudioDevicePropertyClockDomain: SCALAR(UInt32, 0);
    case kAudioDevicePropertyDeviceIsAlive: SCALAR(UInt32, 1);
    case kAudioDevicePropertyDeviceIsRunning: {
      pthread_mutex_lock(&gMutex);
      UInt32 running = gIOCount > 0;
      pthread_mutex_unlock(&gMutex);
      SCALAR(UInt32, running);
    }
    // Only as a microphone: macOS must never switch the speakers to it.
    case kAudioDevicePropertyDeviceCanBeDefaultDevice: SCALAR(UInt32, a->mScope == kAudioObjectPropertyScopeInput);
    case kAudioDevicePropertyDeviceCanBeDefaultSystemDevice: SCALAR(UInt32, 0);
    case kAudioDevicePropertyLatency: SCALAR(UInt32, 0);
    case kAudioDevicePropertySafetyOffset: SCALAR(UInt32, 0);
    case kAudioDevicePropertyNominalSampleRate: SCALAR(Float64, kSampleRate);
    case kAudioDevicePropertyAvailableNominalSampleRates: {
      AudioValueRange range = {kSampleRate, kSampleRate};
      SCALAR(AudioValueRange, range);
    }
    case kAudioDevicePropertyIsHidden: SCALAR(UInt32, 0);
    case kAudioDevicePropertyZeroTimeStampPeriod: SCALAR(UInt32, kRingFrames);
    case kAudioDevicePropertyClockIsStable: SCALAR(UInt32, 1);
    case kAudioObjectPropertyOwnedObjects:
    case kAudioDevicePropertyStreams:
      if (a->mScope == kAudioObjectPropertyScopeInput) return ObjectList(input, 1, inDataSize, outDataSize, out);
      if (a->mScope == kAudioObjectPropertyScopeOutput) return ObjectList(output, 1, inDataSize, outDataSize, out);
      return ObjectList(both, 2, inDataSize, outDataSize, out);
    case kAudioObjectPropertyControlList: return ObjectList(NULL, 0, inDataSize, outDataSize, out);
    case kAudioDevicePropertyRelatedDevices: {
      static const AudioObjectID self[] = {kObjectID_Device};
      return ObjectList(self, 1, inDataSize, outDataSize, out);
    }
    case kAudioDevicePropertyPreferredChannelsForStereo: {
      UInt32 size = 2 * sizeof(UInt32);
      if (out != NULL) {
        if (inDataSize < size) return kAudioHardwareBadPropertySizeError;
        ((UInt32*)out)[0] = 1;
        ((UInt32*)out)[1] = 2;
      }
      *outDataSize = size;
      return kAudioHardwareNoError;
    }
    case kAudioDevicePropertyPreferredChannelLayout: {
      UInt32 size = (UInt32)(offsetof(AudioChannelLayout, mChannelDescriptions) + kChannels * sizeof(AudioChannelDescription));
      if (out != NULL) {
        if (inDataSize < size) return kAudioHardwareBadPropertySizeError;
        AudioChannelLayout* layout = (AudioChannelLayout*)out;
        memset(layout, 0, size);
        layout->mChannelLayoutTag = kAudioChannelLayoutTag_UseChannelDescriptions;
        layout->mNumberChannelDescriptions = kChannels;
        layout->mChannelDescriptions[0].mChannelLabel = kAudioChannelLabel_Left;
        layout->mChannelDescriptions[1].mChannelLabel = kAudioChannelLabel_Right;
      }
      *outDataSize = size;
      return kAudioHardwareNoError;
    }
    default: return kAudioHardwareUnknownPropertyError;
  }
}

static OSStatus StreamProperty(AudioObjectID obj, const AudioObjectPropertyAddress* a, UInt32 inDataSize, UInt32* outDataSize,
                               void* out) {
  Boolean isInput = obj == kObjectID_StreamInput;
  switch (a->mSelector) {
    case kAudioObjectPropertyBaseClass: SCALAR(AudioClassID, kAudioObjectClassID);
    case kAudioObjectPropertyClass: SCALAR(AudioClassID, kAudioStreamClassID);
    case kAudioObjectPropertyOwner: SCALAR(AudioObjectID, kObjectID_Device);
    case kAudioObjectPropertyOwnedObjects: return ObjectList(NULL, 0, inDataSize, outDataSize, out);
    case kAudioStreamPropertyIsActive: {
      pthread_mutex_lock(&gMutex);
      UInt32 active = isInput ? gInputActive : gOutputActive;
      pthread_mutex_unlock(&gMutex);
      SCALAR(UInt32, active);
    }
    case kAudioStreamPropertyDirection: SCALAR(UInt32, isInput ? 1 : 0);
    case kAudioStreamPropertyTerminalType:
      SCALAR(UInt32, isInput ? kAudioStreamTerminalTypeMicrophone : kAudioStreamTerminalTypeSpeaker);
    case kAudioStreamPropertyStartingChannel: SCALAR(UInt32, 1);
    case kAudioStreamPropertyLatency: SCALAR(UInt32, 0);
    case kAudioStreamPropertyVirtualFormat:
    case kAudioStreamPropertyPhysicalFormat: SCALAR(AudioStreamBasicDescription, StreamFormat());
    case kAudioStreamPropertyAvailableVirtualFormats:
    case kAudioStreamPropertyAvailablePhysicalFormats: {
      AudioStreamRangedDescription ranged;
      ranged.mFormat = StreamFormat();
      ranged.mSampleRateRange.mMinimum = kSampleRate;
      ranged.mSampleRateRange.mMaximum = kSampleRate;
      SCALAR(AudioStreamRangedDescription, ranged);
    }
    default: return kAudioHardwareUnknownPropertyError;
  }
}

/// One place answers both the size and the data: with `out` NULL it only sizes.
static OSStatus Property(AudioObjectID obj, const AudioObjectPropertyAddress* a, UInt32 qsz, const void* q, UInt32 inDataSize,
                         UInt32* outDataSize, void* out) {
  switch (obj) {
    case kObjectID_PlugIn: return PlugInProperty(a, qsz, q, inDataSize, outDataSize, out);
    case kObjectID_Device: return DeviceProperty(a, inDataSize, outDataSize, out);
    case kObjectID_StreamInput:
    case kObjectID_StreamOutput: return StreamProperty(obj, a, inDataSize, outDataSize, out);
    default: return kAudioHardwareBadObjectError;
  }
}

static Boolean Lingora_HasProperty(AudioServerPlugInDriverRef inDriver, AudioObjectID inObjectID, pid_t inClientProcessID,
                                   const AudioObjectPropertyAddress* inAddress) {
  (void)inClientProcessID;
  if (inDriver != gDriverRef || inAddress == NULL) return false;
  UInt32 size = 0;
  return Property(inObjectID, inAddress, 0, NULL, 0, &size, NULL) == kAudioHardwareNoError;
}

static OSStatus Lingora_IsPropertySettable(AudioServerPlugInDriverRef inDriver, AudioObjectID inObjectID,
                                           pid_t inClientProcessID, const AudioObjectPropertyAddress* inAddress,
                                           Boolean* outIsSettable) {
  (void)inClientProcessID;
  if (inDriver != gDriverRef || inAddress == NULL || outIsSettable == NULL) return kAudioHardwareBadObjectError;
  UInt32 size = 0;
  OSStatus status = Property(inObjectID, inAddress, 0, NULL, 0, &size, NULL);
  if (status != kAudioHardwareNoError) return status;
  *outIsSettable = (inObjectID == kObjectID_StreamInput || inObjectID == kObjectID_StreamOutput) &&
                   (inAddress->mSelector == kAudioStreamPropertyIsActive ||
                    inAddress->mSelector == kAudioStreamPropertyVirtualFormat ||
                    inAddress->mSelector == kAudioStreamPropertyPhysicalFormat);
  return kAudioHardwareNoError;
}

static OSStatus Lingora_GetPropertyDataSize(AudioServerPlugInDriverRef inDriver, AudioObjectID inObjectID,
                                            pid_t inClientProcessID, const AudioObjectPropertyAddress* inAddress,
                                            UInt32 inQualifierDataSize, const void* inQualifierData, UInt32* outDataSize) {
  (void)inClientProcessID;
  if (inDriver != gDriverRef || inAddress == NULL || outDataSize == NULL) return kAudioHardwareBadObjectError;
  return Property(inObjectID, inAddress, inQualifierDataSize, inQualifierData, 0, outDataSize, NULL);
}

static OSStatus Lingora_GetPropertyData(AudioServerPlugInDriverRef inDriver, AudioObjectID inObjectID, pid_t inClientProcessID,
                                        const AudioObjectPropertyAddress* inAddress, UInt32 inQualifierDataSize,
                                        const void* inQualifierData, UInt32 inDataSize, UInt32* outDataSize, void* outData) {
  (void)inClientProcessID;
  if (inDriver != gDriverRef || inAddress == NULL || outDataSize == NULL || outData == NULL)
    return kAudioHardwareBadObjectError;
  return Property(inObjectID, inAddress, inQualifierDataSize, inQualifierData, inDataSize, outDataSize, outData);
}

static OSStatus Lingora_SetPropertyData(AudioServerPlugInDriverRef inDriver, AudioObjectID inObjectID, pid_t inClientProcessID,
                                        const AudioObjectPropertyAddress* inAddress, UInt32 inQualifierDataSize,
                                        const void* inQualifierData, UInt32 inDataSize, const void* inData) {
  (void)inClientProcessID, (void)inQualifierDataSize, (void)inQualifierData;
  if (inDriver != gDriverRef || inAddress == NULL || inData == NULL) return kAudioHardwareBadObjectError;
  if (inObjectID != kObjectID_StreamInput && inObjectID != kObjectID_StreamOutput) return kAudioHardwareUnknownPropertyError;

  switch (inAddress->mSelector) {
    case kAudioStreamPropertyIsActive: {
      if (inDataSize != sizeof(UInt32)) return kAudioHardwareBadPropertySizeError;
      UInt32 active = *(const UInt32*)inData != 0;
      pthread_mutex_lock(&gMutex);
      UInt32* slot = inObjectID == kObjectID_StreamInput ? &gInputActive : &gOutputActive;
      Boolean changed = *slot != active;
      *slot = active;
      pthread_mutex_unlock(&gMutex);
      if (changed && gHost != NULL) {
        AudioObjectPropertyAddress changedAddress = {kAudioStreamPropertyIsActive, kAudioObjectPropertyScopeGlobal,
                                                     kAudioObjectPropertyElementMain};
        gHost->PropertiesChanged(gHost, inObjectID, 1, &changedAddress);
      }
      return kAudioHardwareNoError;
    }
    case kAudioStreamPropertyVirtualFormat:
    case kAudioStreamPropertyPhysicalFormat: {
      // The format is fixed: accept it unchanged, refuse anything else.
      if (inDataSize != sizeof(AudioStreamBasicDescription)) return kAudioHardwareBadPropertySizeError;
      const AudioStreamBasicDescription* f = (const AudioStreamBasicDescription*)inData;
      AudioStreamBasicDescription ours = StreamFormat();
      if (f->mFormatID != ours.mFormatID || f->mChannelsPerFrame != ours.mChannelsPerFrame ||
          f->mBitsPerChannel != ours.mBitsPerChannel || f->mSampleRate != ours.mSampleRate)
        return kAudioDeviceUnsupportedFormatError;
      return kAudioHardwareNoError;
    }
    default: return kAudioHardwareUnknownPropertyError;
  }
}

// MARK: - IO

static OSStatus Lingora_StartIO(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID, UInt32 inClientID) {
  (void)inClientID;
  if (inDriver != gDriverRef || inDeviceObjectID != kObjectID_Device) return kAudioHardwareBadObjectError;
  pthread_mutex_lock(&gMutex);
  if (gIOCount == 0) {
    gNumberTimeStamps = 0;
    gAnchorHostTime = mach_absolute_time();
    gWriteStart = 0;
    gWriteEnd = 0;
    memset(gRing, 0, sizeof(gRing));
  }
  gIOCount++;
  pthread_mutex_unlock(&gMutex);
  return kAudioHardwareNoError;
}

static OSStatus Lingora_StopIO(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID, UInt32 inClientID) {
  (void)inClientID;
  if (inDriver != gDriverRef || inDeviceObjectID != kObjectID_Device) return kAudioHardwareBadObjectError;
  pthread_mutex_lock(&gMutex);
  if (gIOCount > 0) gIOCount--;
  pthread_mutex_unlock(&gMutex);
  return kAudioHardwareNoError;
}

/// A steady clock from the host time: one time stamp per ring period.
static OSStatus Lingora_GetZeroTimeStamp(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID, UInt32 inClientID,
                                         Float64* outSampleTime, UInt64* outHostTime, UInt64* outSeed) {
  (void)inClientID;
  if (inDriver != gDriverRef || inDeviceObjectID != kObjectID_Device) return kAudioHardwareBadObjectError;
  Float64 ticksPerRing = gHostTicksPerFrame * kRingFrames;
  UInt64 now = mach_absolute_time();
  UInt64 next = gAnchorHostTime + (UInt64)((Float64)(gNumberTimeStamps + 1) * ticksPerRing);
  if (next <= now) gNumberTimeStamps++;
  *outSampleTime = (Float64)(gNumberTimeStamps * kRingFrames);
  *outHostTime = gAnchorHostTime + (UInt64)((Float64)gNumberTimeStamps * ticksPerRing);
  *outSeed = 1;
  return kAudioHardwareNoError;
}

static OSStatus Lingora_WillDoIOOperation(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID, UInt32 inClientID,
                                          UInt32 inOperationID, Boolean* outWillDo, Boolean* outWillDoInPlace) {
  (void)inClientID;
  if (inDriver != gDriverRef || inDeviceObjectID != kObjectID_Device) return kAudioHardwareBadObjectError;
  Boolean willDo = inOperationID == kAudioServerPlugInIOOperationReadInput ||
                   inOperationID == kAudioServerPlugInIOOperationWriteMix;
  if (outWillDo != NULL) *outWillDo = willDo;
  if (outWillDoInPlace != NULL) *outWillDoInPlace = true;
  return kAudioHardwareNoError;
}

static OSStatus Lingora_BeginIOOperation(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID, UInt32 inClientID,
                                         UInt32 inOperationID, UInt32 inIOBufferFrameSize,
                                         const AudioServerPlugInIOCycleInfo* inIOCycleInfo) {
  (void)inClientID, (void)inOperationID, (void)inIOBufferFrameSize, (void)inIOCycleInfo;
  if (inDriver != gDriverRef || inDeviceObjectID != kObjectID_Device) return kAudioHardwareBadObjectError;
  return kAudioHardwareNoError;
}

/// Both operations run on the device's single IO thread, one after the
/// other, so the ring needs no lock here.
static OSStatus Lingora_DoIOOperation(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID, AudioObjectID inStreamObjectID,
                                      UInt32 inClientID, UInt32 inOperationID, UInt32 inIOBufferFrameSize,
                                      const AudioServerPlugInIOCycleInfo* inIOCycleInfo, void* ioMainBuffer,
                                      void* ioSecondaryBuffer) {
  (void)inClientID, (void)ioSecondaryBuffer;
  if (inDriver != gDriverRef || inDeviceObjectID != kObjectID_Device) return kAudioHardwareBadObjectError;
  if (ioMainBuffer == NULL || inIOCycleInfo == NULL) return kAudioHardwareNoError;
  Float32* buffer = (Float32*)ioMainBuffer;

  if (inOperationID == kAudioServerPlugInIOOperationWriteMix && inStreamObjectID == kObjectID_StreamOutput) {
    SInt64 start = (SInt64)inIOCycleInfo->mOutputTime.mSampleTime;
    if (start != gWriteEnd) gWriteStart = start;  // a gap: older frames are stale
    for (UInt32 i = 0; i < inIOBufferFrameSize; i++) {
      UInt64 slot = (UInt64)(start + i) % kRingFrames;
      memcpy(&gRing[slot * kChannels], &buffer[i * kChannels], kChannels * sizeof(Float32));
    }
    gWriteEnd = start + inIOBufferFrameSize;
  } else if (inOperationID == kAudioServerPlugInIOOperationReadInput && inStreamObjectID == kObjectID_StreamInput) {
    SInt64 start = (SInt64)inIOCycleInfo->mInputTime.mSampleTime;
    SInt64 oldest = gWriteEnd - kRingFrames > gWriteStart ? gWriteEnd - kRingFrames : gWriteStart;
    for (UInt32 i = 0; i < inIOBufferFrameSize; i++) {
      SInt64 t = start + i;
      if (t >= oldest && t < gWriteEnd) {
        UInt64 slot = (UInt64)t % kRingFrames;
        memcpy(&buffer[i * kChannels], &gRing[slot * kChannels], kChannels * sizeof(Float32));
      } else {
        memset(&buffer[i * kChannels], 0, kChannels * sizeof(Float32));
      }
    }
  }
  return kAudioHardwareNoError;
}

static OSStatus Lingora_EndIOOperation(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID, UInt32 inClientID,
                                       UInt32 inOperationID, UInt32 inIOBufferFrameSize,
                                       const AudioServerPlugInIOCycleInfo* inIOCycleInfo) {
  (void)inClientID, (void)inOperationID, (void)inIOBufferFrameSize, (void)inIOCycleInfo;
  if (inDriver != gDriverRef || inDeviceObjectID != kObjectID_Device) return kAudioHardwareBadObjectError;
  return kAudioHardwareNoError;
}
