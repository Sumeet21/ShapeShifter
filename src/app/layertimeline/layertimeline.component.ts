import * as _ from 'lodash';
import * as $ from 'jquery';
import {
  Component, OnInit, ChangeDetectionStrategy, OnDestroy,
} from '@angular/core';

import { Callbacks as TimelineAnimationRowCallbacks } from './timelineanimationrow.component';
import { Callbacks as LayerListTreeCallbacks } from './layerlisttree.component';
import { ScrubEvent } from './layertimeline.directive';

import { VectorLayer, Layer, GroupLayer, LayerUtil, PathLayer, ClipPathLayer } from '../scripts/layers';
import { Animation, AnimationBlock } from '../scripts/animations';
import { Dragger } from '../scripts/dragger';
import { ModelUtil } from '../scripts/common';

import { Store } from '@ngrx/store';
import {
  State,
  getAnimations,
  getVectorLayers,
  getSelectedAnimationId,
  getActiveAnimationId,
  getSelectedBlockIds,
} from '../scripts/store/reducers';
import {
  AddAnimations,
  SelectAnimationId,
  ActivateAnimationId,
  AddAnimationBlock,
  SelectAnimationBlockId,
  ReplaceAnimationBlocks,
  AddVectorLayers,
  ReplaceVectorLayer,
  SelectLayerId,
  ToggleLayerIdExpansion,
  ToggleLayerIdVisibility,
  AddLayer,
} from '../scripts/store/actions';
import { Observable } from 'rxjs/Observable';
import { BehaviorSubject } from 'rxjs/BehaviorSubject';
import 'rxjs/add/observable/combineLatest';

// Distance in pixels from a snap point before snapping to the point.
const SNAP_PIXELS = 10;
const LAYER_INDENT_PIXELS = 20;
const MIN_BLOCK_DURATION = 10;
const MAX_ZOOM = 10;
const MIN_ZOOM = 0.01;

enum MouseActions {
  Moving = 1,
  ScalingUniformStart,
  ScalingUniformEnd,
  ScalingTogetherStart,
  ScalingTogetherEnd,
}

@Component({
  selector: 'app-layertimeline',
  templateUrl: './layertimeline.component.html',
  styleUrls: ['./layertimeline.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LayerTimelineComponent implements
  OnInit,
  TimelineAnimationRowCallbacks,
  LayerListTreeCallbacks {

  // Layer timeline variables.
  horizZoom = 2; // 1ms = 2px
  activeTime = 10;
  dragIndicatorSource = new BehaviorSubject<DragIndicatorInfo>({
    isVisible: false, left: 0, top: 0,
  });

  private shouldSuppressClick = false;
  private shouldSuppressRebuildSnapTimes = false;
  private snapTimes: Map<string, number[]>;

  private animations: ReadonlyArray<Animation>;
  private vectorLayers: ReadonlyArray<VectorLayer>;
  private selectedBlockIds: Set<string>;

  layerTimelineModel$: Observable<LayerTimelineModel>;

  constructor(private readonly store: Store<State>) { }

  ngOnInit() {
    this.layerTimelineModel$ = Observable.combineLatest(
      this.store.select(getAnimations),
      this.store.select(getVectorLayers),
      this.store.select(getSelectedAnimationId),
      this.store.select(getActiveAnimationId),
      this.store.select(getSelectedBlockIds),
    ).map(([
      animations, vectorLayers, selectedAnimationId, activeAnimationId, selectedBlockIds,
    ]) => {
      this.animations = animations;
      this.rebuildSnapTimes();
      this.vectorLayers = vectorLayers;
      this.selectedBlockIds = selectedBlockIds;
      return {
        animations,
        vectorLayers,
        selectedAnimationId,
        activeAnimationId,
      }
    });
  }

  // Called from the LayerTimelineComponent template.
  animationHeaderTextClick(event: MouseEvent, animation: Animation) {
    this.store.dispatch(new SelectAnimationId(animation.id));
  }

  // Called from the LayerTimelineComponent template.
  timelineHeaderScrub(event: ScrubEvent) {
    // TODO: implement this
  }

  addPathLayerClick() {
    // TODO: implement this (most of the codebase assumes pathData will be non-null)
  }

  addClipPathLayerClick() {
    // TODO: implement this (most of the codebase assumes pathData will be non-null)
  }

  addGroupLayerClick() {
    const layer = new GroupLayer({ id: undefined, name: 'TODO: fix this', children: [] });
    this.store.dispatch(new AddLayer(layer));
  }

  // Called from the LayerTimelineComponent template.
  animationTimelineMouseDown(event: MouseEvent, animation: Animation) {
    this.store.dispatch(new ActivateAnimationId(animation.id));
  }

  // @Override TimelineAnimationRowCallbacks
  timelineBlockMouseDown(
    mouseDownEvent: MouseEvent,
    dragBlock: AnimationBlock<any>,
    animation: Animation,
    layer: Layer,
  ) {
    // TODO: not sure if this JQuery 'class' stuff will work with view encapsulation?
    const $target = $(mouseDownEvent.target);

    // Some geometry and hit-testing basics.
    const animRect = $(mouseDownEvent.target).parents('.slt-property').get(0).getBoundingClientRect();
    const xToTimeFn = x => (x - animRect.left) / animRect.width * animation.duration;
    const downTime = xToTimeFn(mouseDownEvent.clientX);

    // Determine the action based on where the user clicked and the modifier keys.
    let action = MouseActions.Moving;
    if ($target.hasClass('slt-timeline-block-edge-end')) {
      action = mouseDownEvent.shiftKey || mouseDownEvent.metaKey
        ? MouseActions.ScalingTogetherEnd
        : MouseActions.ScalingUniformEnd;
    } else if ($target.hasClass('slt-timeline-block-edge-start')) {
      action = mouseDownEvent.shiftKey || mouseDownEvent.metaKey
        ? MouseActions.ScalingTogetherStart
        : MouseActions.ScalingUniformStart;
    }

    // Start up a cache of info for each selected block, calculating the left and right
    // bounds for each selected block, based on adjacent non-dragging blocks.
    const blocksByPropertyByLayer = ModelUtil.getOrderedBlocksByPropertyByLayer(animation);

    // Either drag all selected blocks or just the mousedown block.
    const selectedBlocks = animation.blocks.filter(block => this.selectedBlockIds.has(block.id));
    const draggingBlocks = this.selectedBlockIds.has(dragBlock.id) ? selectedBlocks : [dragBlock];

    interface BlockInfo {
      block: AnimationBlock<any>;
      startBound: number;
      endBound: number;
      downStartTime: number;
      downEndTime: number;
      newStartTime?: number;
      newEndTime?: number;
    }

    const blockInfos: BlockInfo[] = draggingBlocks
      .map(block => {
        // By default the block is only bound by the animation duration.
        let startBound = 0;
        let endBound = animation.duration;

        const blockNeighbors = blocksByPropertyByLayer[block.layerId][block.propertyName];
        const indexIntoNeighbors = _.findIndex(blockNeighbors, b => block.id === b.id);

        // Find start time bound.
        if (indexIntoNeighbors > 0) {
          for (let i = indexIntoNeighbors - 1; i >= 0; i--) {
            const neighbor = blockNeighbors[i];
            if (!draggingBlocks.includes(neighbor)
              || action === MouseActions.ScalingUniformStart) {
              // Only be bound by neighbors not being dragged
              // except when uniformly changing just start time.
              startBound = neighbor.endTime;
              break;
            }
          }
        }

        // Find end time bound.
        if (indexIntoNeighbors < blockNeighbors.length - 1) {
          for (let i = indexIntoNeighbors + 1; i < blockNeighbors.length; i++) {
            const neighbor = blockNeighbors[i];
            if (!draggingBlocks.includes(neighbor)
              || action === MouseActions.ScalingUniformEnd) {
              // Only be bound by neighbors not being dragged
              // except when uniformly changing just end time.
              endBound = neighbor.startTime;
              break;
            }
          }
        }

        return {
          block,
          startBound,
          endBound,
          downStartTime: block.startTime,
          downEndTime: block.endTime,
        };
      });

    const dragBlockDownStartTime = dragBlock.startTime;
    const dragBlockDownEndTime = dragBlock.endTime;

    let minStartTime, maxEndTime;
    if (action === MouseActions.ScalingTogetherStart
      || action === MouseActions.ScalingTogetherEnd) {
      minStartTime = blockInfos.reduce(
        (t, info) => Math.min(t, info.block.startTime), Infinity);
      maxEndTime = blockInfos.reduce(
        (t, info) => Math.max(t, info.block.endTime), 0);
      // Avoid divide by zero.
      maxEndTime = Math.max(maxEndTime, minStartTime + MIN_BLOCK_DURATION);
    }

    // tslint:disable-next-line
    new Dragger({
      direction: 'horizontal',
      downX: mouseDownEvent.clientX,
      downY: mouseDownEvent.clientY,
      draggingCursor: (action === MouseActions.Moving) ? 'grabbing' : 'ew-resize',
      onBeginDragFn: () => {
        this.shouldSuppressClick = true;
        this.shouldSuppressRebuildSnapTimes = true;
      },
      onDropFn: () => setTimeout(() => {
        this.shouldSuppressClick = false;
        this.shouldSuppressRebuildSnapTimes = false;
        this.rebuildSnapTimes();
      }, 0),
      onDragFn: event => {
        let timeDelta = Math.round(xToTimeFn(event.clientX) - downTime);
        const allowSnap = !event.shiftKey && !event.metaKey;
        const replacementBlocks: AnimationBlock<any>[] = [];
        switch (action) {
          case MouseActions.Moving: {
            blockInfos.forEach(info => {
              // Snap time delta.
              if (allowSnap && info.block.id === dragBlock.id) {
                const newStartTime = info.downStartTime + timeDelta;
                const newStartTimeSnapDelta = this.snapTime(animation, newStartTime) - newStartTime;
                const newEndTime = info.downEndTime + timeDelta;
                const newEndTimeSnapDelta = this.snapTime(animation, newEndTime) - newEndTime;
                if (newStartTimeSnapDelta) {
                  if (newEndTimeSnapDelta) {
                    timeDelta += Math.min(newStartTimeSnapDelta, newEndTimeSnapDelta);
                  } else {
                    timeDelta += newStartTimeSnapDelta;
                  }
                } else if (newEndTimeSnapDelta) {
                  timeDelta += newEndTimeSnapDelta;
                }
              }
              // Constrain time delta.
              timeDelta = Math.min(timeDelta, info.endBound - info.downEndTime);
              timeDelta = Math.max(timeDelta, info.startBound - info.downStartTime);
            });
            blockInfos.forEach(info => {
              const blockDuration = (info.block.endTime - info.block.startTime);
              const block = info.block.clone();
              block.startTime = info.downStartTime + timeDelta;
              block.endTime = block.startTime + blockDuration;
              replacementBlocks.push(block);
            });
            break;
          }
          case MouseActions.ScalingUniformStart: {
            blockInfos.forEach(info => {
              // Snap time delta.
              if (allowSnap && info.block.id === dragBlock.id) {
                const newStartTime = info.downStartTime + timeDelta;
                const newStartTimeSnapDelta = this.snapTime(animation, newStartTime) - newStartTime;
                if (newStartTimeSnapDelta) {
                  timeDelta += newStartTimeSnapDelta;
                }
              }
              // Constrain time delta.
              timeDelta = Math.min(timeDelta, (info.block.endTime - MIN_BLOCK_DURATION) - info.downStartTime);
              timeDelta = Math.max(timeDelta, info.startBound - info.downStartTime);
            });
            blockInfos.forEach(info => {
              const block = info.block.clone();
              block.startTime = info.downStartTime + timeDelta;
              replacementBlocks.push(block);
            });
            break;
          }
          case MouseActions.ScalingUniformEnd: {
            blockInfos.forEach(info => {
              // Snap time delta.
              if (allowSnap && info.block === dragBlock) {
                const newEndTime = info.downEndTime + timeDelta;
                const newEndTimeSnapDelta = this.snapTime(animation, newEndTime) - newEndTime;
                if (newEndTimeSnapDelta) {
                  timeDelta += newEndTimeSnapDelta;
                }
              }
              // Constrain time delta.
              timeDelta = Math.min(timeDelta, info.endBound - info.downEndTime);
              timeDelta = Math.max(timeDelta, (info.block.startTime + MIN_BLOCK_DURATION) - info.downEndTime);
            });
            blockInfos.forEach(info => {
              const block = info.block.clone();
              block.endTime = info.downEndTime + timeDelta;
              replacementBlocks.push(block);
            });
            break;
          }
          case MouseActions.ScalingTogetherStart: {
            let scale = (dragBlockDownStartTime + timeDelta - maxEndTime)
              / (dragBlockDownStartTime - maxEndTime);
            scale = Math.min(scale, maxEndTime / (maxEndTime - minStartTime));
            let cancel = false;
            blockInfos.forEach(info => {
              info.newStartTime = maxEndTime - (maxEndTime - info.downStartTime) * scale;
              info.newEndTime = Math.max(
                maxEndTime - (maxEndTime - info.downEndTime) * scale,
                info.newStartTime + MIN_BLOCK_DURATION);
              if (info.newStartTime < info.startBound || info.newEndTime > info.endBound) {
                cancel = true;
              }
            });
            if (!cancel) {
              blockInfos.forEach(info => {
                const block = info.block.clone();
                block.startTime = info.newStartTime;
                block.endTime = info.newEndTime;
                replacementBlocks.push(block);
              });
            }
            break;
          }
          case MouseActions.ScalingTogetherEnd: {
            let scale = (dragBlockDownEndTime + timeDelta - minStartTime)
              / (dragBlockDownEndTime - minStartTime);
            scale = Math.min(scale, (animation.duration - minStartTime) / (maxEndTime - minStartTime));
            let cancel = false;
            blockInfos.forEach(info => {
              info.newStartTime = minStartTime + (info.downStartTime - minStartTime) * scale;
              info.newEndTime = Math.max(
                minStartTime + (info.downEndTime - minStartTime) * scale,
                info.newStartTime + MIN_BLOCK_DURATION);
              if (info.newStartTime < info.startBound || info.newEndTime > info.endBound) {
                cancel = true;
              }
            });
            if (!cancel) {
              blockInfos.forEach(info => {
                const block = info.block.clone();
                block.startTime = info.newStartTime;
                block.endTime = info.newEndTime;
                replacementBlocks.push(block);
              });
            }
            break;
          }
        }
        this.store.dispatch(new ReplaceAnimationBlocks(replacementBlocks));
      },
    });
  }

  /**
   * Builds a cache of snap times for all available animations.
   */
  private rebuildSnapTimes() {
    if (this.shouldSuppressRebuildSnapTimes) {
      return;
    }
    this.snapTimes = new Map();
    if (this.animations) {
      this.animations.forEach(animation => {
        const snapTimesSet = new Set<number>();
        snapTimesSet.add(0);
        snapTimesSet.add(animation.duration);
        animation.blocks.forEach(block => {
          snapTimesSet.add(block.startTime);
          snapTimesSet.add(block.endTime);
        });
        this.snapTimes.set(animation.id, Array.from(snapTimesSet));
      });
    }
  }

  /**
   * Returns a new time, possibly snapped to animation boundaries
   */
  private snapTime(animation: Animation, time: number, includeActiveTime = true) {
    const snapTimes = this.snapTimes.get(animation.id);
    const snapDelta = SNAP_PIXELS / this.horizZoom;
    const reducerFn = (bestSnapTime, snapTime) => {
      const dist = Math.abs(time - snapTime);
      return (dist < snapDelta && dist < Math.abs(time - bestSnapTime))
        ? snapTime
        : bestSnapTime;
    };
    let bestSnapTime = snapTimes.reduce(reducerFn, Infinity);
    if (includeActiveTime) {
      bestSnapTime = reducerFn(bestSnapTime, this.activeTime);
    }
    return isFinite(bestSnapTime) ? bestSnapTime : time;
  }

  // @Override TimelineAnimationRowCallbacks
  timelineBlockClick(
    event: MouseEvent,
    block: AnimationBlock<any>,
    animation: Animation,
    layer: Layer,
  ) {
    const clearExisting = !event.metaKey && !event.shiftKey;
    this.store.dispatch(new SelectAnimationBlockId(block.id, clearExisting));
  }

  // @Override LayerListTreeComponentCallbacks
  addTimelineBlockClick(
    event: MouseEvent,
    layer: Layer,
    propertyName: string,
  ) {
    this.store.dispatch(new AddAnimationBlock(layer, propertyName));
  }

  // @Override LayerListTreeComponentCallbacks
  layerClick(event: MouseEvent, layer: Layer) {
    const clearExisting = !event.metaKey && !event.shiftKey;
    this.store.dispatch(new SelectLayerId(layer.id, clearExisting));
  }

  // @Override LayerListTreeComponentCallbacks
  layerToggleExpanded(event: MouseEvent, layer: Layer) {
    const recursive = event.metaKey || event.shiftKey
    this.store.dispatch(new ToggleLayerIdExpansion(layer.id, recursive));
  }

  // @Override LayerListTreeComponentCallbacks
  layerToggleVisibility(event: MouseEvent, layer: Layer) {
    this.store.dispatch(new ToggleLayerIdVisibility(layer.id));
  }

  // @Override LayerListTreeComponentCallbacks
  layerMouseDown(mouseDownEvent: MouseEvent, dragLayer: Layer) {
    const $layersList = $(mouseDownEvent.target).parents('.slt-layers-list');
    const $scroller = $(mouseDownEvent.target).parents('.slt-layers-list-scroller');

    interface LayerInfo {
      layer: Layer;
      element: Element;
      localRect: ClientRect;
      moveIntoEmptyLayerGroup?: boolean;
    }

    let orderedLayerInfos: LayerInfo[] = [];
    let scrollerRect: ClientRect;
    let targetLayerInfo: LayerInfo;
    let targetEdge: string;

    // TODO: make sure it is impossible to drag layers across different vector layers?
    const vectorLayers = this.vectorLayers;

    // tslint:disable-next-line
    new Dragger({
      direction: 'both',
      downX: mouseDownEvent.clientX,
      downY: mouseDownEvent.clientY,

      onBeginDragFn: () => {
        // console.info('onBeginDragStart');
        this.shouldSuppressClick = true;

        // build up a list of all layers ordered by Y position
        orderedLayerInfos = [];
        scrollerRect = $scroller.get(0).getBoundingClientRect();
        const scrollTop = $scroller.scrollTop();
        $layersList.find('.slt-layer-container').each((_, element) => {
          // toString() is necessary because JQuery converts the ID into a number.
          const layerId: string = ($(element).data('layer-id') || '').toString();
          if (!layerId) {
            // The root layer doesn't have an ID set.
            return;
          }

          let rect = element.getBoundingClientRect();
          rect = {
            left: rect.left,
            top: rect.top + scrollTop - scrollerRect.top,
            bottom: rect.bottom + scrollTop - scrollerRect.top,
            height: rect.height,
            right: rect.right,
            width: rect.width,
          };

          const layer = this.findLayerById(layerId);
          orderedLayerInfos.push({
            layer,
            element,
            localRect: rect,
          });

          // Add a fake target for empty groups.
          if (layer instanceof GroupLayer && !layer.children.length) {
            rect = Object.assign({}, rect, {
              left: rect.left + LAYER_INDENT_PIXELS, top: rect.bottom,
            });
            orderedLayerInfos.push({
              layer,
              element,
              localRect: rect,
              moveIntoEmptyLayerGroup: true,
            });
          }
        });

        orderedLayerInfos.sort((a, b) => a.localRect.top - b.localRect.top);
        this.updateDragIndicator({ isVisible: true, left: 0, top: 0 });
      },

      onDragFn: event => {
        const localEventY = event.clientY - scrollerRect.top + $scroller.scrollTop();
        // Find the target layer and edge (top or bottom).
        targetLayerInfo = undefined;
        let minDistance = Infinity;
        let minDistanceIndent = Infinity; // Tie break to most indented layer.
        for (let i = 0; i < orderedLayerInfos.length; i++) {
          const layerInfo = orderedLayerInfos[i];

          // Skip if mouse to the left of this layer.
          if (event.clientX < layerInfo.localRect.left) {
            continue;
          }

          for (const edge of ['top', 'bottom']) {
            // Test distance to top edge.
            const distance = Math.abs(localEventY - layerInfo.localRect[edge]);
            const indent = layerInfo.localRect.left;
            if (distance <= minDistance) {
              if (distance !== minDistance || indent > minDistanceIndent) {
                minDistance = distance;
                minDistanceIndent = indent;
                targetLayerInfo = layerInfo;
                targetEdge = edge;
              }
            }
          }
        }

        // Disallow dragging a layer into itself or its children.
        if (targetLayerInfo) {
          let layer = targetLayerInfo.layer;
          while (layer) {
            if (layer === dragLayer) {
              // console.info('targetLayerInfo=', undefined);
              targetLayerInfo = undefined;
              break;
            }
            layer = LayerUtil.findParent(this.vectorLayers, layer.id);
          }
        }

        if (targetLayerInfo && targetEdge === 'bottom'
          && LayerUtil.findNextSibling(this.vectorLayers, targetLayerInfo.layer.id) === dragLayer) {
          targetLayerInfo = undefined;
        }

        const dragIndicatorInfo: DragIndicatorInfo = { isVisible: !!targetLayerInfo };
        if (targetLayerInfo) {
          dragIndicatorInfo.left = targetLayerInfo.localRect.left;
          dragIndicatorInfo.top = targetLayerInfo.localRect[targetEdge];
        }
        this.updateDragIndicator(dragIndicatorInfo);
      },

      onDropFn: () => {
        this.updateDragIndicator({ isVisible: false });

        if (targetLayerInfo) {
          const root = LayerUtil.findVectorLayer(this.vectorLayers, dragLayer.id);
          let replacementVl: VectorLayer;
          if (targetLayerInfo.moveIntoEmptyLayerGroup) {
            // Moving into an empty layer group.
            replacementVl = LayerUtil.removeLayerFromTree(this.vectorLayers, dragLayer.id);
            const newParent = targetLayerInfo.layer;
            replacementVl =
              LayerUtil.addLayerToTree(
                replacementVl, newParent.id, dragLayer.clone(), newParent.children.length);
          } else {
            // Moving next to another layer.
            let newParent = LayerUtil.findParent(this.vectorLayers, targetLayerInfo.layer.id);
            if (newParent) {
              replacementVl = LayerUtil.removeLayerFromTree(this.vectorLayers, dragLayer.id);
              newParent = LayerUtil.findParent([replacementVl], targetLayerInfo.layer.id);
              let index =
                newParent.children
                  ? _.findIndex(newParent.children, child => child.id === targetLayerInfo.layer.id)
                  : -1;
              if (index >= 0) {
                index += (targetEdge === 'top') ? 0 : 1;
                replacementVl =
                  LayerUtil.addLayerToTree(replacementVl, newParent.id, dragLayer.clone(), index);
              }
            }
          }
          if (replacementVl) {
            setTimeout(() => {
              this.store.dispatch(new ReplaceVectorLayer(replacementVl));
            });
          }
        }

        setTimeout(() => this.shouldSuppressClick = false, 0);
      }
    });
  }

  private findLayerById(id: string) {
    for (const vl of this.vectorLayers) {
      const layer = vl.findLayerById(id);
      if (layer) {
        return layer;
      }
    }
    return undefined;
  }

  private updateDragIndicator(info: DragIndicatorInfo) {
    const curr = this.dragIndicatorSource.getValue();
    this.dragIndicatorSource.next(Object.assign({}, curr, info));
  }

  trackLayerFn(index: number, layer: Layer) {
    return layer.id;
  }

  trackAnimationFn(index: number, animation: Animation) {
    return animation.id;
  }
}

interface LayerTimelineModel {
  readonly animations: ReadonlyArray<Animation>;
  readonly vectorLayers: ReadonlyArray<VectorLayer>;
  readonly selectedAnimationId: string;
}

interface DragIndicatorInfo {
  left?: number;
  top?: number;
  isVisible?: boolean;
}