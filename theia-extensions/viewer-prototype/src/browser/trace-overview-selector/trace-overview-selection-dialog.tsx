
// import { ReactDialog  } from '@theia/core/lib/browser/dialogs/react-dialog';
import { ListRowProps, AutoSizer, List } from 'react-virtualized';
import {  DialogProps } from '@theia/core/lib/browser/dialogs';
import React from 'react';
import { OutputDescriptor } from 'tsp-typescript-client/lib/models/output-descriptor';
import { injectable } from '@theia/core/shared/inversify';
import { Message } from '@theia/core/lib/browser/widgets';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';

@injectable()
export class TraceOverviewSelectionDialogProps extends DialogProps {
}

export class TraceOverviewSelectionDialogService{
    static async showOpenDialog(outputDescriptors: OutputDescriptor[]): Promise<OutputDescriptor | undefined> {
        const dialogProps: DialogProps = {
            title: 'Select overview source'
        };
        console.log('Open dialog:: Opening the dialog', outputDescriptors);
        const dialog = new TraceOverviewSelectionDialog(dialogProps, outputDescriptors);
        const returnedValue = await dialog.open();
        console.log('Open dialog:: Returned value static class', returnedValue);

        return returnedValue;
    }
}

@injectable()
export class TraceOverviewSelectionDialog extends ReactDialog<OutputDescriptor>{

    static ID = 'trace-overview-selection-dialog';
    static LABEL = 'Available Views';
    static LIST_MARGIN = 2;
    static LINE_HEIGHT = 16;
    static ROW_HEIGHT = (2 * TraceOverviewSelectionDialog.LINE_HEIGHT) + TraceOverviewSelectionDialog.LIST_MARGIN;

    private outputDescriptor: OutputDescriptor[];
    private selectedOutput: OutputDescriptor;

    protected handleOutputClicked = (e: React.MouseEvent<HTMLDivElement>): void => this.doHandleOutputClicked(e);

    constructor(props: DialogProps, output: OutputDescriptor[]){
        super(props);
        this.outputDescriptor = output;
        console.log('Open dialog:: TraceOverviewSelectionDialog', this.outputDescriptor);
    }

    protected override onCloseRequest(msg: Message): void {
        super.onCloseRequest(msg);
        this.accept();
    }

    get value(): OutputDescriptor {
        return this.selectedOutput;
    }

    render(): React.ReactNode{
        const key = Number(true);
        let outputsRowCount = 0;
        if (this.outputDescriptor) {
            outputsRowCount = this.outputDescriptor.length;
        }
        const totalHeight = this.getTotalHeight();

        return (
            <div>
                <div>
                    <AutoSizer>
                        {({ width }) =>
                            <List
                                key={key}
                                height={totalHeight}
                                width={width}
                                rowCount={outputsRowCount}
                                rowHeight={TraceOverviewSelectionDialog.ROW_HEIGHT}
                                rowRenderer={this.renderRowOutputs}
                            />
                        }
                    </AutoSizer>
                </div>
            </div>
        );
    }

    protected renderRowOutputs = (props: ListRowProps): React.ReactNode => this.doRenderRowOutputs(props);

    private doRenderRowOutputs(props: ListRowProps): React.ReactNode {
        console.log('Open dialog:: Render row output');
        let outputName = '';
        let outputDescription = '';
        let output: OutputDescriptor | undefined;
        const outputDescriptors = this.outputDescriptor;
        if (outputDescriptors && outputDescriptors.length && props.index < outputDescriptors.length) {
            output = outputDescriptors[props.index];
            outputName = output.name;
            outputDescription = output.description;
        }
        const traceContainerClassName = 'outputs-list-container';
        // if (props.index === this.state.lastSelectedOutputIndex) {
        //     traceContainerClassName = traceContainerClassName + ' theia-mod-selected';
        // }
        return <div className={traceContainerClassName}
            title={outputName + ':\n' + outputDescription}
            // id={`${traceContainerClassName}-${props.index}`}
            key={props.key}
            style={props.style}
            onClick={this.handleOutputClicked}
            // onContextMenu={event => { this.handleContextMenuEvent(event, output); }}
            data-id={`${props.index}`}
        >
            <h4 className='outputs-element-name'>
                {outputName}
            </h4>
            <div className='outputs-element-description child-element'>
                {outputDescription}
            </div>
        </div>;
    }

    private doHandleOutputClicked(e: React.MouseEvent<HTMLDivElement>) {
        const index = Number(e.currentTarget.getAttribute('data-id'));
        this.selectedOutput = this.outputDescriptor[index];
        this.accept();
    }

    protected getTotalHeight(): number {
        let totalHeight = 0;
        const outputDescriptors = this.outputDescriptor;
        outputDescriptors?.forEach(() => totalHeight += TraceOverviewSelectionDialog.ROW_HEIGHT);
        return totalHeight;
    }
}
