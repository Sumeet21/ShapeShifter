import { Animation, AnimationBlock, PathAnimationBlock } from 'app/model/timeline';

export function createHtml(svgText: string, cssFileName: string) {
  return `<html>
<head>
  <link rel="stylesheet" type="text/css" href="${cssFileName}" />
</head>
<body>
${svgText}
</body>
</html>
`;
}

export function createCss(animation: Animation) {
  const anims = animation.blocks.map(block => createCssAnimation(block));
  const keyframes = animation.blocks.map(block => blockToCssKeyframes(block));
  return `
${keyframes.join('\n')}
${anims.join('\n')}
`;
}

// TODO: don't use the block id here?
// TODO: need to specify a start delay?
function createCssAnimation(block: AnimationBlock) {
  // TODO: need to correctly set the interpolator value here
  const interpolator = 'ease'; // block.interpolator;
  const duration = block.endTime - block.startTime;
  return `#block_${block.id} {
  animation: block_${block.id}_animation ${duration}ms ${interpolator} forwards;
}`;
}

// TODO: don't use the block id here?
function blockToCssKeyframes(block: AnimationBlock) {
  let { fromValue, toValue } = block;
  if (block instanceof PathAnimationBlock) {
    fromValue = `path('${fromValue.getPathString()}')`;
    toValue = `path('${toValue.getPathString()}')`;
  }
  // TODO: need to use the correct property name here?
  return `
@keyframes block_${block.id}_animation {
  from {
    ${block.propertyName}: ${fromValue};
  }
  to {
    ${block.propertyName}: ${toValue};
  }
}`;
}
