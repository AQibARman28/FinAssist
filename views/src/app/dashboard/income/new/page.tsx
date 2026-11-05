import { IncomeForm, IncomeFormFrame } from "@/components/dashboard/income/IncomeForm";

export default function NewIncomePage() {
    return (
        <IncomeFormFrame mode="create">
            <IncomeForm mode="create" />
        </IncomeFormFrame>
    );
}
