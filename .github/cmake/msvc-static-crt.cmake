# llama.cpp con Ninja y MSVC: sin esto CMake pone /MD por encima del /MT que pide
# llama-cpp-sys-2 (LLAMA_STATIC_CRT) y no casaría con sherpa-onnx al enlazar.
# Lo lee el crate cmake por la variable CMAKE_TOOLCHAIN_FILE (windows-check.yml).
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded")
