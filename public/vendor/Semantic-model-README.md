# 本地中文检索组件

- Transformers.js 4.3.0，Apache-2.0，见 Transformers-js-LICENSE.txt。
- ONNX Runtime Web 1.31.0-dev.20260914-8d85527a0，MIT，见 ONNX-Runtime-LICENSE.txt。
- BAAI bge-small-zh-v1.5，模型卡标注 MIT，见 BGE-LICENSE.txt；Xenova ONNX 转换版固定提交 75c43b069aac4d136ba6bc1122f995fedcfd2781，Q8 权重。

公开来源：[BAAI 模型与方法](https://huggingface.co/BAAI/bge-small-zh-v1.5)，[Xenova ONNX 文件](https://huggingface.co/Xenova/bge-small-zh-v1.5/tree/75c43b069aac4d136ba6bc1122f995fedcfd2781)，[Transformers.js](https://github.com/huggingface/transformers.js)，[ONNX Runtime](https://github.com/microsoft/onnxruntime)。

模型和 WASM 文件经固定白名单、长度与 SHA-256 核对后缓存。浏览器只下载公开模型组件；客户原文和查询不会提交到这些来源。向量在检索面板内存中计算，关闭后释放。首轮模型验证只覆盖所列中文样例，不能推断所有行业的检索准确率。
