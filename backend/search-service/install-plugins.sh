#!/bin/bash
# ES 插件安装脚本

ES_VERSION="8.12.0"
PLUGIN_DIR="./plugins"

mkdir -p "$PLUGIN_DIR"

echo "Installing IK Analyzer plugin..."
cd "$PLUGIN_DIR"

# 下载 IK 分词器
if [ ! -d "ik" ]; then
  mkdir -p ik
  curl -L -o ik.zip "https://github.com/medcl/elasticsearch-analysis-ik/releases/download/v${ES_VERSION}/elasticsearch-analysis-ik-${ES_VERSION}.zip"
  unzip -o ik.zip -d ik/
  rm ik.zip
  echo "IK plugin installed"
else
  echo "IK plugin already exists"
fi

# 下载拼音插件
if [ ! -d "pinyin" ]; then
  mkdir -p pinyin
  curl -L -o pinyin.zip "https://github.com/medcl/elasticsearch-analysis-pinyin/releases/download/v${ES_VERSION}/elasticsearch-analysis-pinyin-${ES_VERSION}.zip"
  unzip -o pinyin.zip -d pinyin/
  rm pinyin.zip
  echo "Pinyin plugin installed"
else
  echo "Pinyin plugin already exists"
fi

cd ..
echo "All plugins installed"
